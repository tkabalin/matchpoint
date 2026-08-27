"""One-off import of sample coaches/players/matches/points from CSV, for the BBD demo
dataset.

Not part of the shipped image or the app's runtime code — run manually, once, by piping
this file into a shell in the api container so it reuses the container's own
matchpoint_api package and MATCHPOINT_DATABASE_URL rather than opening a separate
connection to prod Postgres.

Running this against prod:

  1. Take a manual backup on top of the daily snapshot, since this is a write to shared
     prod state:
       ssh matchpoint-prod
       docker compose -f /opt/matchpoint/compose.yml exec -T postgres \\
           pg_dump -U matchpoint matchpoint > backup-before-import.sql
  2. scp coaches.csv players.csv matches.csv, and points.csv if there is one, to the
     VPS, then copy each into the api container (compose has no volume mount for
     arbitrary host files):
       docker compose -f /opt/matchpoint/compose.yml cp coaches.csv api:/tmp/coaches.csv
       docker compose -f /opt/matchpoint/compose.yml cp players.csv api:/tmp/players.csv
       docker compose -f /opt/matchpoint/compose.yml cp matches.csv api:/tmp/matches.csv
       docker compose -f /opt/matchpoint/compose.yml cp points.csv api:/tmp/points.csv
  3. Run the script with the container's own Python and environment:
       docker compose -f /opt/matchpoint/compose.yml exec -T api python - < import_sample_data.py
  4. Record the printed demo password somewhere it won't get lost.

Expected CSV files, read from /tmp inside the container:

  coaches.csv:  email,display_name
  players.csv:  coach_email,first_name,last_name,date_of_birth,dominant_hand,gender,notes
  matches.csv:  coach_email,player_first_name,player_last_name,opponent_name,played_on,
                surface,event,scoring_system,result,match_key
  points.csv:   coach_email,match_key,sequence,server,won,serve1_outcome,serve1_box,
                serve1_fault_mode,serve2_outcome,serve2_box,serve2_fault_mode,
                return_outcome,end_reason,unusual_reason,note,wing,shot_type,ball_in,
                ball_half,ball_depth,ball_out_mode,rally_length_bucket,set_number,
                game_number,in_tiebreak,is_break_point,is_game_point,is_game_end,
                is_set_point,is_set_end,is_match_point

- date_of_birth: ISO format (YYYY-MM-DD), blank = unset.
- played_on: ISO format (YYYY-MM-DD), and required — a match is filed by the date it
  was played, so there is no such thing as a match without one.
- dominant_hand: right | left (blank = unset)
- gender: male | female | other (blank = unset)
- surface: hard | clay | grass | carpet (blank = unset)
- scoring_system: traditional | mens_grand_slam | no_ad_scoring |
  match_tiebreak_10_points | short_sets | pro_set | legacy (blank = unset)
- result: win | loss (blank = unset)
- match_key: an arbitrary label, unique per coach (blank = this match has no points).
  It exists only to join points.csv to a match here; it is never stored, so a match
  created without points never needs one.

- players.csv/matches.csv link back to coaches.csv by coach_email; matches.csv links to
  players.csv by (coach_email, player_first_name, player_last_name) — there's no id
  column in the source data, so that triple has to be unique per coach.
- points.csv is optional and, if present, one row per point in capture order, joined to
  a match by (coach_email, match_key). Every enum/boolean column matches
  `schemas/point.py`'s `PointCreate` exactly, which is what validates each row (shape
  only, same as live capture) before it is stored — see that schema for which columns
  pair up (e.g. wing with shot_type) and which are conditional on another column
  (e.g. unusual_reason only on an `end_reason` of `unusual`). Booleans are
  `true | false` (also accepts `1 | 0` and `yes | no`); blank means unset on an optional
  column. `match_sets` needs nothing of its own — it's recomputed from the imported
  points, same as a live sync would.

All imported coaches share one password, printed at the end, since sample coaches are
never signed up for real and the CSV carries no password to hash.

Re-running is safe: the same CSVs a second time reuse what is already stored rather than
duplicating it, so a corrected dataset can simply be imported again. A row is recognised
by its natural key — a coach by email, a player by (coach, first_name, last_name), a
match by (player, played_on, opponent_name, event), a point by (match, sequence) — and
everything past that key is refreshed from the CSV, which is what makes a correction
land. A match cannot be recognised by its match_key, since that is never stored, which
is why those four columns have to tell one of a player's matches from another. Two things
are deliberately not refreshed: a player keeps the username minted on its first import,
being what that player signs in with, and a point already stored is left as it is rather
than rewritten, the rule the ingest route follows for a repeated point.
"""

import csv
import secrets
import uuid
from datetime import date
from pathlib import Path
from typing import NamedTuple

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from matchpoint_api.db import session_factory
from matchpoint_api.match_sets import recompute_match_sets
from matchpoint_api.models import (
    Coach,
    CourtDepth,
    CourtSide,
    DominantHand,
    EndReason,
    FailureMode,
    Gender,
    Match,
    MatchResult,
    MatchSide,
    Player,
    Point,
    RallyBucket,
    ReturnOutcome,
    ScoringSystem,
    ServeOutcome,
    ShotType,
    Surface,
    UnusualReason,
    Wing,
)
from matchpoint_api.schemas.point import PointCreate
from matchpoint_api.security import hash_password
from matchpoint_api.usernames import next_username

CSV_DIR = "/tmp"

_TRUE_VALUES = {"true", "1", "yes"}
_FALSE_VALUES = {"false", "0", "no"}


class ImportSummary(NamedTuple):
    """What one run wrote, split by whether the row was already there.

    The reused counts are what tell an operator a re-run converged rather than doubling
    the dataset.
    """

    coaches_created: int
    coaches_reused: int
    players_created: int
    players_reused: int
    matches_created: int
    matches_reused: int
    points_created: int
    points_skipped: int
    matches_recomputed: int


def _blank_to_none(value: str) -> str | None:
    return value.strip() or None


def _parse_date(value: str) -> date | None:
    parsed = _blank_to_none(value)
    return date.fromisoformat(parsed) if parsed else None


def _parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    raise ValueError(f"expected a boolean value, got {value!r}")


def run_import(db: Session, csv_dir: Path, password_hash: str) -> ImportSummary:
    """Import every CSV in csv_dir, reporting what it wrote.

    The caller owns the commit, so a failure part-way through leaves the whole import
    unwritten. The password hash is a parameter because every imported coach shares one,
    and it is the caller that mints the password and prints it afterwards.
    """
    with (csv_dir / "coaches.csv").open(newline="") as f:
        coach_rows = list(csv.DictReader(f))
    # Coach.email is lowercased by the model on write and by a CHECK in the table, so a
    # lowercased cell is the stored value and needs no folding beyond this.
    coach_by_email: dict[str, Coach] = {
        coach.email: coach
        for coach in db.scalars(
            select(Coach).where(Coach.email.in_([row["email"].lower() for row in coach_rows]))
        )
    }
    coaches_created = coaches_reused = 0
    for row in coach_rows:
        email = row["email"].lower()
        coach = coach_by_email.get(email)
        if coach is None:
            coach = Coach(email=row["email"], display_name=row["display_name"])
            db.add(coach)
            coaches_created += 1
        else:
            coaches_reused += 1
        # Set on a reused coach too: main() prints one password and says it works for
        # every imported coach, which would be false for the ones already there.
        coach.display_name = row["display_name"]
        coach.password_hash = password_hash
        coach_by_email[email] = coach
    db.flush()

    with (csv_dir / "players.csv").open(newline="") as f:
        player_rows = list(csv.DictReader(f))
    coach_ids = {coach.id for coach in coach_by_email.values()}
    player_by_identity: dict[tuple[uuid.UUID, str, str], Player] = {
        (player.coach_id, player.first_name, player.last_name): player
        for player in db.scalars(select(Player).where(Player.coach_id.in_(coach_ids)))
    }
    players_created = players_reused = 0
    player_by_key: dict[tuple[str, str, str], Player] = {}
    for row in player_rows:
        coach = coach_by_email[row["coach_email"].lower()]
        date_of_birth = _parse_date(row["date_of_birth"])
        dominant_hand = DominantHand(v) if (v := _blank_to_none(row["dominant_hand"])) else None
        gender = Gender(v) if (v := _blank_to_none(row["gender"])) else None
        notes = _blank_to_none(row["notes"])
        identity = (coach.id, row["first_name"], row["last_name"])
        player = player_by_identity.get(identity)
        if player is None:
            player = Player(
                coach_id=coach.id,
                first_name=row["first_name"],
                last_name=row["last_name"],
                # NOT NULL and never client-chosen, so the import mints one the same way
                # the create route does. Its query autoflushes the players added earlier
                # in this loop, which is what numbers two names that fold alike 001 then
                # 002 rather than both 001. A reused player keeps the one it has: it is
                # that player's sign-in identifier.
                username=next_username(db, row["first_name"], row["last_name"]),
            )
            db.add(player)
            players_created += 1
        else:
            players_reused += 1
        player.date_of_birth = date_of_birth
        player.dominant_hand = dominant_hand
        player.gender = gender
        player.notes = notes
        player_by_identity[identity] = player
        player_by_key[(coach.email.lower(), player.first_name, player.last_name)] = player
    db.flush()

    with (csv_dir / "matches.csv").open(newline="") as f:
        match_rows = list(csv.DictReader(f))
    player_ids = {player.id for player in player_by_key.values()}
    # A match carries no natural key of its own, so it is identified by the four columns
    # that distinguish one of a player's matches from another. match_key cannot serve:
    # it is never stored, so a second run has nothing to recognise.
    match_by_identity: dict[tuple[uuid.UUID, date, str | None, str | None], Match] = {
        (match.player_id, match.played_on, match.opponent_name, match.event): match
        for match in db.scalars(select(Match).where(Match.player_id.in_(player_ids)))
    }
    matches_created = matches_reused = 0
    match_by_key: dict[tuple[str, str], Match] = {}
    for line_number, row in enumerate(match_rows, start=2):
        player_key = (
            row["coach_email"].lower(),
            row["player_first_name"],
            row["player_last_name"],
        )
        # Named for the same reason the parse errors below are: a name that matches no
        # players.csv row is the likeliest slip in a hand-edited file, and a bare
        # KeyError over the triple says nothing about which line carried it.
        if (player := player_by_key.get(player_key)) is None:
            raise ValueError(f"matches.csv line {line_number}: no players.csv row for {player_key}")
        # Wrapped the way the points loop is: a bad date or enum value here would
        # otherwise surface as a constraint violation naming a column, with nothing
        # to say which of a few hundred hand-edited rows produced it.
        try:
            played_on = _parse_date(row["played_on"])
            if played_on is None:
                raise ValueError("played_on is required, since a match is filed by date")
            surface = Surface(v) if (v := _blank_to_none(row["surface"])) else None
            scoring_system = (
                ScoringSystem(v) if (v := _blank_to_none(row["scoring_system"])) else None
            )
            result = MatchResult(v) if (v := _blank_to_none(row["result"])) else None
        except ValueError as exc:
            raise ValueError(f"matches.csv line {line_number}: {exc}") from exc
        opponent_name = _blank_to_none(row["opponent_name"])
        event = _blank_to_none(row["event"])
        identity = (player.id, played_on, opponent_name, event)
        match = match_by_identity.get(identity)
        if match is None:
            match = Match(
                player_id=player.id,
                opponent_name=opponent_name,
                played_on=played_on,
                event=event,
            )
            db.add(match)
            matches_created += 1
        else:
            matches_reused += 1
        match.surface = surface
        match.scoring_system = scoring_system
        match.result = result
        match_by_identity[identity] = match
        if match_key := _blank_to_none(row["match_key"]):
            match_by_key[(row["coach_email"].lower(), match_key)] = match
    # match.id is a Python-side default, only assigned to the instance on flush;
    # points.csv needs it to set match_id below.
    db.flush()

    points_created = points_skipped = 0
    point_values: list[dict[str, object]] = []
    matches_with_points: set[uuid.UUID] = set()
    points_path = csv_dir / "points.csv"
    if points_path.exists():
        with points_path.open(newline="") as f:
            for line_number, row in enumerate(csv.DictReader(f), start=2):
                # Named for the reason the player lookup above is: a match_key with no
                # matches.csv row behind it is a typo, and the line is what finds it.
                match_lookup = (row["coach_email"].lower(), row["match_key"])
                if (match := match_by_key.get(match_lookup)) is None:
                    raise ValueError(
                        f"points.csv line {line_number}: no matches.csv row with "
                        f"match_key {match_lookup}"
                    )
                ball_in = _blank_to_none(row["ball_in"])
                try:
                    point_data = PointCreate(
                        id=uuid.uuid4(),
                        sequence=int(row["sequence"]),
                        server=MatchSide(row["server"]),
                        won=_parse_bool(row["won"]),
                        serve1_outcome=ServeOutcome(row["serve1_outcome"]),
                        serve1_box=CourtSide(v)
                        if (v := _blank_to_none(row["serve1_box"]))
                        else None,
                        serve1_fault_mode=FailureMode(v)
                        if (v := _blank_to_none(row["serve1_fault_mode"]))
                        else None,
                        serve2_outcome=ServeOutcome(v)
                        if (v := _blank_to_none(row["serve2_outcome"]))
                        else None,
                        serve2_box=CourtSide(v)
                        if (v := _blank_to_none(row["serve2_box"]))
                        else None,
                        serve2_fault_mode=FailureMode(v)
                        if (v := _blank_to_none(row["serve2_fault_mode"]))
                        else None,
                        return_outcome=ReturnOutcome(v)
                        if (v := _blank_to_none(row["return_outcome"]))
                        else None,
                        end_reason=EndReason(row["end_reason"]),
                        unusual_reason=UnusualReason(v)
                        if (v := _blank_to_none(row["unusual_reason"]))
                        else None,
                        note=_blank_to_none(row["note"]),
                        wing=Wing(v) if (v := _blank_to_none(row["wing"])) else None,
                        shot_type=ShotType(v) if (v := _blank_to_none(row["shot_type"])) else None,
                        ball_in=_parse_bool(ball_in) if ball_in else None,
                        ball_half=CourtSide(v) if (v := _blank_to_none(row["ball_half"])) else None,
                        ball_depth=CourtDepth(v)
                        if (v := _blank_to_none(row["ball_depth"]))
                        else None,
                        ball_out_mode=FailureMode(v)
                        if (v := _blank_to_none(row["ball_out_mode"]))
                        else None,
                        rally_length_bucket=RallyBucket(v)
                        if (v := _blank_to_none(row["rally_length_bucket"]))
                        else None,
                        set_number=int(row["set_number"]),
                        game_number=int(row["game_number"]),
                        in_tiebreak=_parse_bool(row["in_tiebreak"]),
                        is_break_point=_parse_bool(row["is_break_point"]),
                        is_game_point=_parse_bool(row["is_game_point"]),
                        is_game_end=_parse_bool(row["is_game_end"]),
                        is_set_point=_parse_bool(row["is_set_point"]),
                        is_set_end=_parse_bool(row["is_set_end"]),
                        is_match_point=_parse_bool(row["is_match_point"]),
                    )
                except (ValidationError, ValueError) as exc:
                    raise ValueError(f"points.csv line {line_number}: {exc}") from exc
                point_values.append({**point_data.model_dump(), "match_id": match.id})
                matches_with_points.add(match.id)

        if point_values:
            # Keyed on (match_id, sequence) rather than on id: the CSV carries no point
            # id, so a fresh uuid4 per row would never recognise a point a previous run
            # already stored. DO NOTHING leaves that stored point as it is, which is the
            # rule the ingest route follows for a repeated one.
            #
            # The rows are passed as execute() parameters rather than to values(), which
            # would render them as one VALUES list: a point spends over 30 bind
            # parameters and the wire protocol allows 65535, so a dataset past roughly
            # 2,300 points would fail the whole import. As parameters, SQLAlchemy pages
            # them into statements that fit.
            landed = db.execute(
                insert(Point)
                .on_conflict_do_nothing(index_elements=[Point.match_id, Point.sequence])
                .returning(Point.id),
                point_values,
            ).all()
            points_created = len(landed)
            points_skipped = len(point_values) - points_created
        # Every match named in points.csv, not only those that gained a point: a re-run
        # that added points to a match already imported has to restate its set scores.
        for match_id in matches_with_points:
            recompute_match_sets(db, match_id)

    return ImportSummary(
        coaches_created=coaches_created,
        coaches_reused=coaches_reused,
        players_created=players_created,
        players_reused=players_reused,
        matches_created=matches_created,
        matches_reused=matches_reused,
        points_created=points_created,
        points_skipped=points_skipped,
        matches_recomputed=len(matches_with_points),
    )


def main() -> None:
    csv_dir = Path(CSV_DIR)
    demo_password = secrets.token_urlsafe(12)
    with session_factory() as db:
        summary = run_import(db, csv_dir, hash_password(demo_password))
        db.commit()

    print(
        f"Coaches: {summary.coaches_created} new, {summary.coaches_reused} already there. "
        f"Players: {summary.players_created} new, {summary.players_reused} already there. "
        f"Matches: {summary.matches_created} new, {summary.matches_reused} already there."
    )
    if (csv_dir / "points.csv").exists():
        print(
            f"Points: {summary.points_created} new, {summary.points_skipped} already there, "
            f"across {summary.matches_recomputed} matches."
        )
    print(f"Demo coach password (same for every imported coach): {demo_password}")


if __name__ == "__main__":
    main()
