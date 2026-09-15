"""The sample-data import, which is the one write path into prod that no route guards.

It runs by hand against shared prod state, so the things worth pinning are the ones a
dry run wouldn't reveal: that a CSV cell parses to what the column expects, and that a
bad row names its own line rather than surfacing as a constraint violation.
"""

import csv
from contextlib import nullcontext
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.models import (
    Coach,
    CourtSide,
    DominantHand,
    EndReason,
    FailureMode,
    Gender,
    Match,
    MatchResult,
    MatchResultReason,
    MatchSet,
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
from matchpoint_api.usernames import username_prefix
from scripts import import_sample_data
from scripts.import_sample_data import _blank_to_none, _parse_bool, _parse_date, run_import
from tests.conftest import image_bytes, stored_photos

# The literal-hash idiom from tests/factories.py: a real Argon2 hash costs ~100 ms, and
# nothing here verifies a password.
STUB_HASH = "$argon2-stub"

COACH_EMAIL = "coach@example.com"


def _write_csv(csv_dir: Path, name: str, rows: list[dict[str, str]]) -> None:
    with (csv_dir / name).open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _write_dataset(
    csv_dir: Path,
    *,
    coaches: list[dict[str, str]] | None = None,
    players: list[dict[str, str]] | None = None,
    matches: list[dict[str, str]] | None = None,
    points: list[dict[str, str]] | None = None,
) -> None:
    """The three mandatory files, plus points.csv only when the test wants one.

    coaches/players/matches are opened unconditionally by the import, so every test
    needs all three even when its subject is one of them.
    """
    _write_csv(csv_dir, "coaches.csv", coaches if coaches is not None else [coach_row()])
    _write_csv(csv_dir, "players.csv", players if players is not None else [player_row()])
    _write_csv(csv_dir, "matches.csv", matches if matches is not None else [match_row()])
    if points is not None:
        _write_csv(csv_dir, "points.csv", points)


def coach_row(**overrides: str) -> dict[str, str]:
    return {"email": COACH_EMAIL, "display_name": "Coach One", "photo": ""} | overrides


def player_row(**overrides: str) -> dict[str, str]:
    return {
        "coach_email": COACH_EMAIL,
        "first_name": "Thomas",
        "last_name": "Kabalin",
        "date_of_birth": "",
        "dominant_hand": "",
        "gender": "",
        "notes": "",
        "photo": "",
    } | overrides


def match_row(**overrides: str) -> dict[str, str]:
    return {
        "coach_email": COACH_EMAIL,
        "player_first_name": "Thomas",
        "player_last_name": "Kabalin",
        "opponent_name": "",
        "played_on": "2026-08-24",
        "surface": "",
        "event": "",
        "scoring_system": "",
        "result": "",
        "result_reason": "",
        "match_key": "m1",
    } | overrides


def point_row(**overrides: str) -> dict[str, str]:
    """A point the tracked player served and lost the rally on, which is the shape that
    fills the most columns: a landed first serve, a struck last shot, a ball that went
    out."""
    return {
        "coach_email": COACH_EMAIL,
        "match_key": "m1",
        "sequence": "0",
        "server": "tracked",
        "won": "true",
        "court_side": "deuce",
        "serve1_outcome": "in",
        "serve1_fault_mode": "",
        "serve2_outcome": "",
        "serve2_fault_mode": "",
        "return_outcome": "",
        "end_reason": "mistake",
        "unusual_reason": "",
        "note": "",
        "wing": "forehand",
        "shot_type": "drive",
        "ball_in": "false",
        "ball_half": "",
        "ball_depth": "",
        "ball_out_mode": "net",
        "rally_length_bucket": "b1",
        "set_number": "1",
        "game_number": "1",
        "in_tiebreak": "false",
        "is_break_point": "false",
        "is_game_point": "false",
        "is_game_end": "false",
        "is_set_point": "false",
        "is_set_end": "false",
        "is_match_point": "false",
    } | overrides


# --- the parsing helpers, which are pure ------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [("Kabalin", "Kabalin"), ("  padded  ", "padded"), ("", None), ("   ", None)],
)
def test_blank_to_none_strips_and_empties(value: str, expected: str | None) -> None:
    assert _blank_to_none(value) == expected


def test_parse_date_reads_an_iso_date() -> None:
    assert _parse_date("2026-08-24") == date(2026, 8, 24)


def test_parse_date_treats_a_blank_cell_as_unset() -> None:
    assert _parse_date("   ") is None


def test_parse_date_refuses_a_malformed_date() -> None:
    with pytest.raises(ValueError):
        _parse_date("24/08/2026")


@pytest.mark.parametrize("value", ["true", "TRUE", " True ", "1", "yes", "YES"])
def test_parse_bool_reads_every_spelling_of_true(value: str) -> None:
    assert _parse_bool(value) is True


@pytest.mark.parametrize("value", ["false", "FALSE", " False ", "0", "no", "NO"])
def test_parse_bool_reads_every_spelling_of_false(value: str) -> None:
    assert _parse_bool(value) is False


@pytest.mark.parametrize("value", ["", "   ", "maybe", "2", "t"])
def test_parse_bool_refuses_anything_else(value: str) -> None:
    """The message quotes the cell, since the caller wraps it with the CSV line number."""
    with pytest.raises(ValueError, match="expected a boolean value"):
        _parse_bool(value)


# --- coaches ----------------------------------------------------------------------


def test_a_coach_row_becomes_a_coach(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(tmp_path)

    run_import(db_session, tmp_path, STUB_HASH)

    coach = db_session.scalars(select(Coach)).one()
    assert coach.email == COACH_EMAIL
    assert coach.display_name == "Coach One"
    assert coach.password_hash == STUB_HASH


def test_a_coach_email_joins_case_insensitively(db_session: Session, tmp_path: Path) -> None:
    """The CSV is hand-written, so the same address arrives cased three different ways."""
    _write_dataset(
        tmp_path,
        coaches=[coach_row(email="Mixed@Example.com")],
        players=[player_row(coach_email="mixed@example.com")],
        matches=[match_row(coach_email="MIXED@EXAMPLE.COM")],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    coach = db_session.scalars(select(Coach)).one()
    player = db_session.scalars(select(Player)).one()
    match = db_session.scalars(select(Match)).one()
    assert coach.email == "mixed@example.com"
    assert player.coach_id == coach.id
    assert match.player_id == player.id


# --- players ----------------------------------------------------------------------


def test_a_player_row_carries_its_optional_columns(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(
        tmp_path,
        players=[
            player_row(
                date_of_birth="2005-03-01",
                dominant_hand="left",
                gender="female",
                notes="Strong backhand, rushes the second serve.",
            )
        ],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    player = db_session.scalars(select(Player)).one()
    assert player.first_name == "Thomas"
    assert player.last_name == "Kabalin"
    assert player.date_of_birth == date(2005, 3, 1)
    assert player.dominant_hand is DominantHand.LEFT
    assert player.gender is Gender.FEMALE
    assert player.notes == "Strong backhand, rushes the second serve."


def test_a_players_blank_columns_land_as_null(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(tmp_path)

    run_import(db_session, tmp_path, STUB_HASH)

    player = db_session.scalars(select(Player)).one()
    assert player.date_of_birth is None
    assert player.dominant_hand is None
    assert player.gender is None
    assert player.notes is None
    assert player.photo_key is None


# --- photos -----------------------------------------------------------------------


def _write_photo(csv_dir: Path, name: str) -> None:
    (csv_dir / "photos").mkdir(exist_ok=True)
    (csv_dir / "photos" / name).write_bytes(image_bytes("JPEG", size=(300, 200)))


def test_a_photo_cell_stores_the_file_under_a_key(
    db_session: Session, tmp_path: Path, media_root: Path
) -> None:
    """The cell names a file next to the CSVs; what lands is the store's own WebP."""
    _write_photo(tmp_path, "one.jpg")
    _write_dataset(
        tmp_path,
        coaches=[coach_row(photo="photos/one.jpg")],
        players=[player_row(photo="photos/one.jpg")],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    coach = db_session.scalars(select(Coach)).one()
    player = db_session.scalars(select(Player)).one()
    assert coach.photo_key is not None and player.photo_key is not None
    assert coach.photo_key != player.photo_key
    assert {path.stem for path in stored_photos(media_root)} == {coach.photo_key, player.photo_key}


def test_a_photo_that_is_not_an_image_fails_the_import(db_session: Session, tmp_path: Path) -> None:
    (tmp_path / "photos").mkdir()
    (tmp_path / "photos" / "not.jpg").write_bytes(b"not an image")
    _write_dataset(tmp_path, players=[player_row(photo="photos/not.jpg")])

    with pytest.raises(import_sample_data.photos.UnusableImage):
        run_import(db_session, tmp_path, STUB_HASH)


def test_a_re_run_keeps_the_photo_already_stored(
    db_session: Session, tmp_path: Path, media_root: Path
) -> None:
    """Refreshing a photo would write a file per run and orphan the last; the row's
    existing one wins, the way its username does."""
    _write_photo(tmp_path, "one.jpg")
    _write_dataset(
        tmp_path,
        coaches=[coach_row(photo="photos/one.jpg")],
        players=[player_row(photo="photos/one.jpg")],
    )
    run_import(db_session, tmp_path, STUB_HASH)
    first_keys = (
        db_session.scalars(select(Coach)).one().photo_key,
        db_session.scalars(select(Player)).one().photo_key,
    )

    run_import(db_session, tmp_path, STUB_HASH)

    assert db_session.scalars(select(Coach)).one().photo_key == first_keys[0]
    assert db_session.scalars(select(Player)).one().photo_key == first_keys[1]
    assert len(stored_photos(media_root)) == 2


def test_a_player_gets_the_username_the_route_would_mint(
    db_session: Session, tmp_path: Path
) -> None:
    """The import is the only writer of players that isn't the create route, and username
    is NOT NULL, so it has to mint one the same way."""
    _write_dataset(tmp_path)

    run_import(db_session, tmp_path, STUB_HASH)

    player = db_session.scalars(select(Player)).one()
    assert player.username == f"{username_prefix('Thomas', 'Kabalin')}001"


def test_players_whose_names_fold_alike_get_distinct_usernames(
    db_session: Session, tmp_path: Path
) -> None:
    """Thomas and Thoko Kabalin both fold to kbltho, so the second has to number 002.

    next_username reads the highest number already stored, and what makes it see a
    sibling added moments earlier in the same loop is the autoflush on its own query.
    """
    _write_dataset(
        tmp_path,
        players=[player_row(), player_row(first_name="Thoko")],
        matches=[match_row()],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    usernames = set(db_session.scalars(select(Player.username)))
    prefix = username_prefix("Thomas", "Kabalin")
    assert usernames == {f"{prefix}001", f"{prefix}002"}


# --- matches ----------------------------------------------------------------------


def test_a_match_row_links_to_its_player_and_carries_its_columns(
    db_session: Session, tmp_path: Path
) -> None:
    _write_dataset(
        tmp_path,
        matches=[
            match_row(
                opponent_name="Rival Player",
                played_on="2026-07-02",
                surface="clay",
                event="Club Champs",
                scoring_system="short_sets",
                result="win",
                result_reason="retirement",
            )
        ],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    player = db_session.scalars(select(Player)).one()
    match = db_session.scalars(select(Match)).one()
    assert match.player_id == player.id
    assert match.opponent_name == "Rival Player"
    assert match.played_on == date(2026, 7, 2)
    assert match.surface is Surface.CLAY
    assert match.event == "Club Champs"
    assert match.scoring_system is ScoringSystem.SHORT_SETS
    assert match.result is MatchResult.WIN
    assert match.result_reason is MatchResultReason.RETIREMENT


def test_a_matchs_blank_columns_land_as_null(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(tmp_path)

    run_import(db_session, tmp_path, STUB_HASH)

    match = db_session.scalars(select(Match)).one()
    assert match.opponent_name is None
    assert match.surface is None
    assert match.event is None
    assert match.scoring_system is None
    assert match.result is None
    assert match.result_reason is None


def test_a_match_row_with_no_played_on_names_its_line(db_session: Session, tmp_path: Path) -> None:
    """played_on is the one mandatory match column, and a blank one used to arrive as a
    NOT NULL violation naming the column but not the row."""
    _write_dataset(tmp_path, matches=[match_row(), match_row(played_on="", match_key="m2")])

    with pytest.raises(ValueError, match=r"matches\.csv line 3: played_on is required"):
        run_import(db_session, tmp_path, STUB_HASH)


def test_a_match_row_with_a_malformed_date_names_its_line(
    db_session: Session, tmp_path: Path
) -> None:
    _write_dataset(tmp_path, matches=[match_row(played_on="24/08/2026")])

    with pytest.raises(ValueError, match=r"matches\.csv line 2"):
        run_import(db_session, tmp_path, STUB_HASH)


def test_a_match_row_with_an_unknown_enum_value_names_its_line(
    db_session: Session, tmp_path: Path
) -> None:
    _write_dataset(tmp_path, matches=[match_row(surface="astroturf")])

    with pytest.raises(ValueError, match=r"matches\.csv line 2") as caught:
        run_import(db_session, tmp_path, STUB_HASH)

    assert "astroturf" in str(caught.value)


def test_a_match_row_naming_an_unknown_player_names_its_line(
    db_session: Session, tmp_path: Path
) -> None:
    """A misspelt name is the likeliest slip in a hand-edited file, and it used to arrive
    as a KeyError over the triple with nothing to say which row held it."""
    _write_dataset(tmp_path, matches=[match_row(player_last_name="Kabalinn")])

    with pytest.raises(ValueError, match=r"matches\.csv line 2: no players\.csv row for") as caught:
        run_import(db_session, tmp_path, STUB_HASH)

    assert "Kabalinn" in str(caught.value)


def test_a_match_with_no_match_key_still_imports(db_session: Session, tmp_path: Path) -> None:
    """match_key exists only to join points.csv, so a match without points needs none."""
    _write_dataset(tmp_path, matches=[match_row(match_key="")])

    run_import(db_session, tmp_path, STUB_HASH)

    assert db_session.scalars(select(Match)).one() is not None


# --- points -----------------------------------------------------------------------


def test_a_point_row_becomes_a_point_on_its_match(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(tmp_path, points=[point_row()])

    run_import(db_session, tmp_path, STUB_HASH)

    match = db_session.scalars(select(Match)).one()
    point = db_session.scalars(select(Point)).one()
    assert point.match_id == match.id
    assert point.sequence == 0
    assert point.server is MatchSide.TRACKED
    assert point.won is True
    assert point.court_side is CourtSide.DEUCE
    assert point.serve1_outcome is ServeOutcome.IN
    assert point.end_reason is EndReason.MISTAKE
    assert point.wing is Wing.FOREHAND
    assert point.shot_type is ShotType.DRIVE
    assert point.ball_in is False
    assert point.ball_out_mode is FailureMode.NET
    assert point.rally_length_bucket is RallyBucket.B1
    assert point.set_number == 1
    assert point.game_number == 1


def test_a_point_row_carries_the_columns_the_other_shape_leaves_blank(
    db_session: Session, tmp_path: Path
) -> None:
    """The opponent's serve, faulted then landed, ending on something unusual — which is
    where serve2, return_outcome, unusual_reason and note are the populated columns."""
    _write_dataset(
        tmp_path,
        points=[
            point_row(
                server="opponent",
                court_side="ad",
                serve1_outcome="fault",
                serve2_outcome="in",
                return_outcome="in",
                end_reason="unusual",
                unusual_reason="net_touch",
                note="Called a let, replayed.",
                wing="",
                shot_type="",
                ball_in="",
                ball_out_mode="",
                rally_length_bucket="b4",
            )
        ],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    point = db_session.scalars(select(Point)).one()
    assert point.server is MatchSide.OPPONENT
    assert point.court_side is CourtSide.AD
    assert point.serve1_outcome is ServeOutcome.FAULT
    assert point.serve2_outcome is ServeOutcome.IN
    assert point.return_outcome is ReturnOutcome.IN
    assert point.end_reason is EndReason.UNUSUAL
    assert point.unusual_reason is UnusualReason.NET_TOUCH
    assert point.note == "Called a let, replayed."
    assert point.rally_length_bucket is RallyBucket.B4
    # end_reason unusual means no contact, so the last-shot columns stay empty.
    assert point.wing is None
    assert point.shot_type is None
    assert point.ball_in is None
    assert point.ball_out_mode is None


def test_a_point_row_breaking_a_schema_rule_names_its_line(
    db_session: Session, tmp_path: Path
) -> None:
    """PointCreate is what validates a row, and its message is passed through: the CSV is
    hand-edited, so the line number is the whole value of the error."""
    _write_dataset(
        tmp_path,
        points=[point_row(), point_row(sequence="1", unusual_reason="net_touch")],
    )

    with pytest.raises(ValueError, match=r"points\.csv line 3") as caught:
        run_import(db_session, tmp_path, STUB_HASH)

    assert "unusual_reason belongs to a point that ended unusually" in str(caught.value)


def test_a_point_row_with_an_unreadable_boolean_names_its_line(
    db_session: Session, tmp_path: Path
) -> None:
    """The other arm of that except: a bad boolean raises before PointCreate is built."""
    _write_dataset(tmp_path, points=[point_row(won="maybe")])

    with pytest.raises(ValueError, match=r"points\.csv line 2: expected a boolean value"):
        run_import(db_session, tmp_path, STUB_HASH)


def test_a_point_row_with_an_unknown_match_key_names_its_line(
    db_session: Session, tmp_path: Path
) -> None:
    """The join is by hand-typed label, so a label with no match behind it is a typo."""
    _write_dataset(tmp_path, points=[point_row(match_key="m7")])

    with pytest.raises(
        ValueError, match=r"points\.csv line 2: no matches\.csv row with match_key"
    ) as caught:
        run_import(db_session, tmp_path, STUB_HASH)

    assert "m7" in str(caught.value)


def test_match_sets_are_recomputed_only_for_matches_with_points(
    db_session: Session, tmp_path: Path
) -> None:
    _write_dataset(
        tmp_path,
        matches=[match_row(), match_row(opponent_name="Nobody", match_key="")],
        points=[point_row(is_game_end="true", is_set_end="true")],
    )

    run_import(db_session, tmp_path, STUB_HASH)

    match_set = db_session.scalars(select(MatchSet)).one()
    point = db_session.scalars(select(Point)).one()
    assert match_set.match_id == point.match_id
    assert match_set.set_number == 1
    assert match_set.games_won_tracked == 1
    assert match_set.winner is MatchSide.TRACKED


def test_an_import_with_no_points_file_writes_no_points(
    db_session: Session, tmp_path: Path
) -> None:
    _write_dataset(tmp_path)

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert summary.points_created == 0
    assert summary.matches_recomputed == 0
    assert db_session.scalar(select(func.count()).select_from(Point)) == 0
    assert db_session.scalar(select(func.count()).select_from(MatchSet)) == 0


def test_a_points_file_with_only_a_header_writes_no_points(
    db_session: Session, tmp_path: Path
) -> None:
    """A points.csv that exists but holds nothing is the shape of a dataset exported
    before any capture had happened, and it must not reach the insert with no rows."""
    _write_dataset(tmp_path)
    (tmp_path / "points.csv").write_text(",".join(point_row()) + "\n")

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert summary.points_created == 0
    assert summary.points_skipped == 0
    assert summary.matches_recomputed == 0
    assert _row_counts(db_session)["points"] == 0


def test_the_summary_counts_what_it_wrote(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(
        tmp_path,
        players=[player_row(), player_row(first_name="Thoko")],
        matches=[match_row(), match_row(opponent_name="Nobody", match_key="m2")],
        points=[point_row(), point_row(sequence="1")],
    )

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert summary == import_sample_data.ImportSummary(
        coaches_created=1,
        coaches_reused=0,
        players_created=2,
        players_reused=0,
        matches_created=2,
        matches_reused=0,
        points_created=2,
        points_skipped=0,
        matches_recomputed=1,
    )


# --- re-running -------------------------------------------------------------------


def _usernames_by_first_name(db: Session) -> dict[str, str]:
    return {
        row.first_name: row.username
        for row in db.execute(select(Player.first_name, Player.username))
    }


def _row_counts(db: Session) -> dict[str, int | None]:
    return {
        "coaches": db.scalar(select(func.count()).select_from(Coach)),
        "players": db.scalar(select(func.count()).select_from(Player)),
        "matches": db.scalar(select(func.count()).select_from(Match)),
        "points": db.scalar(select(func.count()).select_from(Point)),
        "match_sets": db.scalar(select(func.count()).select_from(MatchSet)),
    }


def test_the_same_csvs_twice_write_one_copy_of_everything(
    db_session: Session, tmp_path: Path
) -> None:
    """The property the whole reuse path exists for: the import is safe to repeat.

    Before this, a second run died on the unique index over coaches.email, and the only
    way back was the pg_dump the runbook tells you to take first.
    """
    _write_dataset(
        tmp_path,
        players=[player_row(), player_row(first_name="Thoko")],
        matches=[match_row(), match_row(opponent_name="Nobody", match_key="m2")],
        points=[point_row(is_game_end="true"), point_row(sequence="1")],
    )
    run_import(db_session, tmp_path, STUB_HASH)
    after_first = _row_counts(db_session)

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert _row_counts(db_session) == after_first
    assert summary == import_sample_data.ImportSummary(
        coaches_created=0,
        coaches_reused=1,
        players_created=0,
        players_reused=2,
        matches_created=0,
        matches_reused=2,
        points_created=0,
        points_skipped=2,
        matches_recomputed=1,
    )


def test_a_re_run_keeps_each_players_username(db_session: Session, tmp_path: Path) -> None:
    """A username is what the player signs in with, so re-minting one would lock them
    out of an account that still works."""
    _write_dataset(tmp_path, players=[player_row(), player_row(first_name="Thoko")])
    run_import(db_session, tmp_path, STUB_HASH)
    minted = _usernames_by_first_name(db_session)

    run_import(db_session, tmp_path, STUB_HASH)

    assert _usernames_by_first_name(db_session) == minted


def test_a_re_run_leaves_a_stored_point_untouched(db_session: Session, tmp_path: Path) -> None:
    """The ids are minted per run, so a rewritten point would show up as a new id."""
    _write_dataset(tmp_path, points=[point_row()])
    run_import(db_session, tmp_path, STUB_HASH)
    stored = db_session.scalars(select(Point)).one()
    original_id, original_note = stored.id, stored.note

    run_import(db_session, tmp_path, STUB_HASH)

    reread = db_session.scalars(select(Point)).one()
    assert reread.id == original_id
    assert reread.note == original_note


def test_a_point_whose_sequence_is_taken_is_skipped_not_rewritten(
    db_session: Session, tmp_path: Path
) -> None:
    """A corrected point is the one correction a re-run does not apply: the ingest route
    treats a point as immutable once stored, and this follows it."""
    _write_dataset(tmp_path, points=[point_row(note="As captured")])
    run_import(db_session, tmp_path, STUB_HASH)

    _write_dataset(tmp_path, points=[point_row(note="Rewritten", rally_length_bucket="b4")])
    summary = run_import(db_session, tmp_path, STUB_HASH)

    point = db_session.scalars(select(Point)).one()
    assert point.note == "As captured"
    assert point.rally_length_bucket is RallyBucket.B1
    assert summary.points_skipped == 1


def test_a_re_run_adds_only_the_rows_the_csvs_gained(db_session: Session, tmp_path: Path) -> None:
    _write_dataset(tmp_path, points=[point_row()])
    run_import(db_session, tmp_path, STUB_HASH)

    _write_dataset(
        tmp_path,
        players=[player_row(), player_row(first_name="Thoko")],
        matches=[match_row(), match_row(player_first_name="Thoko", match_key="m2")],
        points=[point_row(), point_row(sequence="1"), point_row(match_key="m2")],
    )
    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert summary.players_created == 1
    assert summary.players_reused == 1
    assert summary.matches_created == 1
    assert summary.matches_reused == 1
    assert summary.points_created == 2
    assert summary.points_skipped == 1
    assert _row_counts(db_session)["points"] == 3


def test_a_re_run_refreshes_a_corrected_player_and_match(
    db_session: Session, tmp_path: Path
) -> None:
    """Correcting the dataset and importing it again is the point of re-running, so the
    CSV wins on everything past the key that identifies the row."""
    _write_dataset(tmp_path)
    run_import(db_session, tmp_path, STUB_HASH)

    _write_dataset(
        tmp_path,
        players=[player_row(dominant_hand="left", notes="Left-handed after all.")],
        matches=[match_row(surface="grass", result="loss", result_reason="walkover")],
    )
    run_import(db_session, tmp_path, STUB_HASH)

    player = db_session.scalars(select(Player)).one()
    match = db_session.scalars(select(Match)).one()
    assert player.dominant_hand is DominantHand.LEFT
    assert player.notes == "Left-handed after all."
    assert match.surface is Surface.GRASS
    assert match.result is MatchResult.LOSS
    assert match.result_reason is MatchResultReason.WALKOVER


def test_a_re_run_rehashes_the_coaches_it_reused(db_session: Session, tmp_path: Path) -> None:
    """main() prints one password and says it works for every imported coach, which would
    be a lie for the coaches that were already there."""
    _write_dataset(tmp_path)
    run_import(db_session, tmp_path, STUB_HASH)

    run_import(db_session, tmp_path, "$argon2-second-run")

    assert db_session.scalars(select(Coach)).one().password_hash == "$argon2-second-run"


def test_two_matches_one_day_apart_only_by_opponent_stay_two(
    db_session: Session, tmp_path: Path
) -> None:
    """opponent_name and event are in the key precisely so a player's two matches on one
    day are two rows, and stay two rather than collapsing on the second run."""
    _write_dataset(
        tmp_path,
        matches=[
            match_row(opponent_name="First Rival", match_key="m1"),
            match_row(opponent_name="Second Rival", match_key="m2"),
        ],
    )
    run_import(db_session, tmp_path, STUB_HASH)

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert _row_counts(db_session)["matches"] == 2
    assert summary.matches_reused == 2


def test_a_re_run_restates_the_set_scores_of_a_match_that_gained_points(
    db_session: Session, tmp_path: Path
) -> None:
    _write_dataset(tmp_path, points=[point_row(is_game_end="true")])
    run_import(db_session, tmp_path, STUB_HASH)
    assert db_session.scalars(select(MatchSet)).one().games_won_tracked == 1

    _write_dataset(
        tmp_path,
        points=[
            point_row(is_game_end="true"),
            point_row(sequence="1", won="false", is_game_end="true"),
        ],
    )
    run_import(db_session, tmp_path, STUB_HASH)

    match_set = db_session.scalars(select(MatchSet)).one()
    assert match_set.games_won_tracked == 1
    assert match_set.games_won_opponent == 1


def test_a_repeated_row_inside_one_points_file_lands_once(
    db_session: Session, tmp_path: Path
) -> None:
    """Postgres applies DO NOTHING within the statement too, so a row pasted twice is
    skipped rather than failing the whole import on the unique index."""
    _write_dataset(tmp_path, points=[point_row(), point_row()])

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert summary.points_created == 1
    assert summary.points_skipped == 1
    assert _row_counts(db_session)["points"] == 1


def test_more_points_than_one_statement_can_carry_still_land(
    db_session: Session, tmp_path: Path
) -> None:
    """A point spends over 30 bind parameters and the protocol allows 65535, so a single
    VALUES list caps out near 2,300 points — under twenty matches' worth of capture.

    Every row is here twice as well, because the pages are separate statements: a repeat
    in a later one meets the row an earlier one already inserted rather than itself.
    """
    points = [point_row(sequence=str(n)) for n in range(2_500)]
    _write_dataset(tmp_path, points=points + points)

    summary = run_import(db_session, tmp_path, STUB_HASH)

    assert summary.points_created == 2_500
    assert summary.points_skipped == 2_500
    assert _row_counts(db_session)["points"] == 2_500


# --- _demo_password() --------------------------------------------------------------


def test_a_demo_password_is_words_a_reader_can_relay() -> None:
    """The shape is the point: an operator reads this off a terminal to someone typing it."""
    password = import_sample_data._demo_password()

    words = password.split("-")
    assert len(words) == 4
    assert all(word in import_sample_data._DEMO_PASSWORD_WORDS for word in words)
    assert password.islower()


def test_demo_passwords_differ_between_runs() -> None:
    """Each import mints its own, so the credential is never a constant in the repo."""
    passwords = {import_sample_data._demo_password() for _ in range(50)}

    assert len(passwords) > 1


# --- main() -----------------------------------------------------------------------


def test_main_imports_from_the_csv_dir_and_prints_the_password(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """main()'s own glue: where the CSVs are read from, and what the operator is told.

    session_factory is patched on this module rather than on matchpoint_api.db, whose
    engine is bound to the dev URL at import time — an unpatched run would write to the
    dev database and escape the fixture's rollback.
    """
    _write_dataset(tmp_path, points=[point_row()])
    monkeypatch.setattr(import_sample_data, "CSV_DIR", str(tmp_path))
    monkeypatch.setattr(import_sample_data, "session_factory", lambda: nullcontext(db_session))
    monkeypatch.setattr(import_sample_data, "hash_password", lambda password: STUB_HASH)

    import_sample_data.main()

    printed = capfd.readouterr().out
    assert "Coaches: 1 new, 0 already there." in printed
    assert "Points: 1 new, 0 already there, across 1 matches." in printed
    password = printed.rsplit("Demo coach password (same for every imported coach): ", 1)[1]
    assert password.strip().count("-") == 3
    assert db_session.scalars(select(Coach)).one().password_hash == STUB_HASH


def test_main_says_nothing_about_points_when_there_is_no_points_file(
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capfd: pytest.CaptureFixture[str],
) -> None:
    _write_dataset(tmp_path)
    monkeypatch.setattr(import_sample_data, "CSV_DIR", str(tmp_path))
    monkeypatch.setattr(import_sample_data, "session_factory", lambda: nullcontext(db_session))
    monkeypatch.setattr(import_sample_data, "hash_password", lambda password: STUB_HASH)

    import_sample_data.main()

    printed = capfd.readouterr().out
    assert "Coaches: 1 new, 0 already there." in printed
    assert "Points:" not in printed
