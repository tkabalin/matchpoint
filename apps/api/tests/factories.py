"""Plain-function factories for building model rows in tests.

Rows are flush()ed, not committed, so they stay inside the test's rolled-back
transaction like everything else done through db_session. `sign_in` and
`verify_email` are the exceptions, and each says at its own commit why: they stand
in for a request that committed, so a route that rolls back must still find the
row afterwards.
"""

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.auth import (
    PLAYER_SESSION_COOKIE,
    RESET_COOKIE,
    SESSION_COOKIE,
    VERIFICATION_COOKIE,
    hash_token,
    new_session_token,
)
from matchpoint_api.models import (
    Coach,
    CoachSession,
    CourtSide,
    DeletedMatch,
    EmailVerification,
    EndReason,
    Match,
    MatchSet,
    MatchSide,
    PasswordReset,
    Player,
    PlayerNote,
    PlayerSession,
    PlayerTransferCode,
    Point,
    ScoreCheckpoint,
    ServeOutcome,
    ShotType,
    Wing,
)


def make_coach(session: Session, **overrides: Any) -> Coach:
    # The email is unique per call rather than a fixed address: the column carries a
    # UNIQUE constraint, so a shared default would make the second coach in any one
    # test fail on it.
    #
    # The hash is obvious nonsense, and verify_password would raise InvalidHashError on
    # it. That is the right default: a real one costs ~100 ms per row, which every
    # coach-touching test would pay for nothing, and sign-up produces its own through the
    # route. A test that needs a verifiable hash passes password_hash=hash_password(...).
    coach = Coach(
        **{
            "email": f"coach-{uuid.uuid4()}@example.com",
            "display_name": "Test Coach",
            "password_hash": "not-a-real-hash",
        }
        | overrides
    )
    session.add(coach)
    session.flush()
    return coach


def make_coach_session(session: Session, **overrides: Any) -> CoachSession:
    if "coach_id" not in overrides:
        overrides["coach_id"] = make_coach(session).id
    # The default hash is unique per call, like the coach email above: token_hash
    # carries a UNIQUE constraint. It is a real SHA-256 for shape only — a test that
    # wants a session a request can present computes hash_token over a token it keeps.
    # The expiry is far enough out that a session never dies mid-test; tests about
    # expiry pass their own.
    coach_session = CoachSession(
        **{
            "token_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            "expires_at": datetime.now(UTC) + timedelta(days=30),
        }
        | overrides
    )
    session.add(coach_session)
    session.flush()
    return coach_session


def sign_in(
    client: TestClient, db_session: Session, coach: Coach, **session_overrides: Any
) -> CoachSession:
    """Give the client a live session for `coach`, arranged rather than logged in.

    Bypassing POST /auth/login is deliberate twice over: the tests using this are not
    about the login route — and the factory coach's fake hash costs nothing where a
    real login pays a full Argon2 verification per test.
    """
    token = new_session_token()
    session_row = make_coach_session(
        db_session, coach_id=coach.id, token_hash=hash_token(token), **session_overrides
    )
    db_session.commit()
    client.cookies.set(SESSION_COOKIE, token)
    return session_row


def sign_in_player(
    client: TestClient, db_session: Session, player: Player, **session_overrides: Any
) -> PlayerSession:
    """Give the client a live player session, arranged rather than logged in.

    sign_in for the other principal, bypassing POST /auth/player/login for the same
    two reasons: the tests using this are not about the login route, and a real login
    pays an Argon2 verification per test.
    """
    token = new_session_token()
    session_row = make_player_session(
        db_session, player_id=player.id, token_hash=hash_token(token), **session_overrides
    )
    db_session.commit()
    client.cookies.set(PLAYER_SESSION_COOKIE, token)
    return session_row


def make_email_verification(session: Session, **overrides: Any) -> EmailVerification:
    # Unique email per call, as make_coach: the column carries a UNIQUE constraint.
    # The default hash is a real SHA-256 for shape only — a test that wants a code a
    # request can answer passes otp_hash=hash_otp(code) over a code it keeps. The
    # expiry is far enough out that a row never dies mid-test; tests about expiry
    # pass their own.
    verification = EmailVerification(
        **{
            "email": f"pending-{uuid.uuid4()}@example.com",
            "otp_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            "expires_at": datetime.now(UTC) + timedelta(minutes=10),
        }
        | overrides
    )
    session.add(verification)
    session.flush()
    return verification


def verify_email(
    client: TestClient, session: Session, email: str, **overrides: Any
) -> EmailVerification:
    # Gives the client the verification cookie POST /coaches demands, arranged rather
    # than earned through request-otp and verify-otp — for _sign_in's reason (the tests
    # this serves are about sign-up, not the OTP routes) plus one of its own: the real
    # flow would send an email per test. Lowercased as verify-otp lowercases, since the
    # row's CHECK refuses anything else; a test about the case fold submits the mixed
    # case to the route, not here.
    #
    # Committed, unlike the factories above, and like _sign_in: the row stands in for
    # one verify-otp committed, and the route rolls back on its 409 path — a row that
    # was only flushed would vanish with the rollback instead of surviving it.
    token = new_session_token()
    verification = make_email_verification(
        session,
        email=email.lower(),
        otp_hash=None,
        token_hash=hash_token(token),
        **overrides,
    )
    session.commit()
    client.cookies.set(VERIFICATION_COOKIE, token)
    return verification


def make_password_reset(session: Session, **overrides: Any) -> PasswordReset:
    if "coach_id" not in overrides:
        overrides["coach_id"] = make_coach(session).id
    # The default hash is a real SHA-256 for shape only, as make_email_verification's
    # is — a test that wants a code a request can answer passes otp_hash=hash_otp(code)
    # over a code it keeps. The expiry outlives any test; tests about expiry pass their own.
    reset = PasswordReset(
        **{
            "otp_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            "expires_at": datetime.now(UTC) + timedelta(minutes=10),
        }
        | overrides
    )
    session.add(reset)
    session.flush()
    return reset


def verify_reset_code(
    client: TestClient, session: Session, coach: Coach, **overrides: Any
) -> PasswordReset:
    # Gives the client the reset cookie POST /auth/reset-password demands, arranged
    # rather than earned through forgot-password and verify-reset-code, for
    # verify_email's reasons, and committed for the same one: the row stands in for one
    # verify-reset-code committed, so a route that rolls back must still find it.
    token = new_session_token()
    reset = make_password_reset(
        session, coach_id=coach.id, otp_hash=None, token_hash=hash_token(token), **overrides
    )
    session.commit()
    client.cookies.set(RESET_COOKIE, token)
    return reset


def make_player(session: Session, **overrides: Any) -> Player:
    if "coach_id" not in overrides:
        overrides["coach_id"] = make_coach(session).id
    # Unique per call, since the column is. Six letters then digits, the shape
    # next_username's max-suffix query parses, under a prefix no real name folds to.
    username = f"tesfac{uuid.uuid4().int % 1_000_000_000:09d}"
    defaults = {"first_name": "Test", "last_name": "Player", "username": username}
    player = Player(**defaults | overrides)
    session.add(player)
    session.flush()
    return player


def make_player_note(session: Session, **overrides: Any) -> PlayerNote:
    if "player_id" not in overrides:
        overrides["player_id"] = make_player(session).id
    # Filed under nothing by default, which is what the quick-note path writes; a test
    # about the focus areas passes its own. The date is fixed rather than today's, so
    # ordering assertions never depend on when the suite runs.
    note = PlayerNote(
        **{"body": "Served well under pressure.", "recorded_on": date(2026, 8, 1)} | overrides
    )
    session.add(note)
    session.flush()
    return note


def make_player_session(session: Session, **overrides: Any) -> PlayerSession:
    if "player_id" not in overrides:
        overrides["player_id"] = make_player(session).id
    # Defaults as make_coach_session's: a unique real-shaped hash, and an expiry far
    # enough out that a session never dies mid-test.
    player_session = PlayerSession(
        **{
            "token_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            "expires_at": datetime.now(UTC) + timedelta(days=30),
        }
        | overrides
    )
    session.add(player_session)
    session.flush()
    return player_session


def make_player_transfer_code(session: Session, **overrides: Any) -> PlayerTransferCode:
    if "player_id" not in overrides:
        overrides["player_id"] = make_player(session).id
    # The default hash is a real SHA-256 for shape only and unique per call, since the
    # column is unique. A test that wants a code a request can redeem passes
    # token_hash=hash_token(code) over a code it keeps.
    transfer = PlayerTransferCode(
        **{"token_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest()} | overrides
    )
    session.add(transfer)
    session.flush()
    return transfer


def make_match(session: Session, **overrides: Any) -> Match:
    if "player_id" not in overrides:
        overrides["player_id"] = make_player(session).id
    # The first of this year rather than a literal date: the squad snapshot's period is
    # the current calendar year, so a fixed year would drop every default-dated match
    # out of it the moment the year turned. Never in the future, whatever today is.
    match = Match(**{"played_on": date(date.today().year, 1, 1)} | overrides)
    session.add(match)
    session.flush()
    return match


def make_deleted_match(session: Session, **overrides: Any) -> DeletedMatch:
    if "coach_id" not in overrides:
        overrides["coach_id"] = make_coach(session).id
    # The tombstone `delete_match` leaves behind. `deleted_at` is stamped now unless a
    # test passes its own, which is how the cases where the window has run out are
    # arranged without waiting it out.
    deleted = DeletedMatch(**{"id": uuid.uuid4(), "deleted_at": datetime.now(UTC)} | overrides)
    session.add(deleted)
    session.flush()
    return deleted


def make_match_set(session: Session, **overrides: Any) -> MatchSet:
    if "match_id" not in overrides:
        overrides["match_id"] = make_match(session).id
    # A finished first set, 6-4 to the tracked player: a set still in flight is the
    # exception, and a test about one passes winner=None with its own tally.
    match_set = MatchSet(
        **{
            "set_number": 1,
            "games_won_tracked": 6,
            "games_won_opponent": 4,
            "winner": MatchSide.TRACKED,
        }
        | overrides
    )
    session.add(match_set)
    session.flush()
    return match_set


def make_point(session: Session, **overrides: Any) -> Point:
    if "match_id" not in overrides:
        overrides["match_id"] = make_match(session).id
    # A tracked-player serve, first serve in, ending on a forced error. The minimal
    # shape the TS contract allows: one serve attempt, no return, a shot recorded, and
    # every stamp filled in as the client's scoring engine always fills them.
    point = Point(
        **{
            "sequence": 0,
            "server": MatchSide.TRACKED,
            "won": True,
            "court_side": CourtSide.DEUCE,
            "serve1_outcome": ServeOutcome.IN,
            "end_reason": EndReason.FORCED,
            "wing": Wing.FOREHAND,
            "shot_type": ShotType.DRIVE,
            "set_number": 1,
            "game_number": 1,
            "in_tiebreak": False,
            "is_break_point": False,
            "is_game_point": False,
            "is_game_end": False,
            "is_set_point": False,
            "is_set_end": False,
            "is_match_point": False,
        }
        | overrides
    )
    session.add(point)
    session.flush()
    return point


def point_payload(**overrides: Any) -> dict[str, Any]:
    """One point as the ingest endpoint receives it: JSON, not a row.

    Here rather than in a test module because the schema tests and the route tests
    both need it, and a point carries enough required fields that spelling them out
    per test would bury what each one is actually varying. A tracked-player serve
    landing in the deuce box, won on a forehand drive that stayed in.
    """
    return {
        "id": str(uuid.uuid4()),
        "sequence": 0,
        "server": "tracked",
        "won": True,
        "court_side": "deuce",
        "serve1_outcome": "in",
        "end_reason": "forced",
        "wing": "forehand",
        "shot_type": "drive",
        "ball_in": True,
        "ball_half": "ad",
        "ball_depth": "deep",
        "set_number": 1,
        "game_number": 1,
        "in_tiebreak": False,
        "is_break_point": False,
        "is_game_point": False,
        "is_game_end": False,
        "is_set_point": False,
        "is_set_end": False,
        "is_match_point": False,
    } | overrides


def snapshot_set(**overrides: Any) -> dict[str, Any]:
    """One set of a declared scoreboard, as the wire and the JSONB column both carry
    it: a 6-4 first set to the tracked player unless a test says otherwise."""
    return {
        "set_number": 1,
        "games_tracked": 6,
        "games_opponent": 4,
        "tiebreak_tracked": None,
        "tiebreak_opponent": None,
        "winner": "tracked",
    } | overrides


def make_score_checkpoint(session: Session, **overrides: Any) -> ScoreCheckpoint:
    if "match_id" not in overrides:
        overrides["match_id"] = make_match(session).id
    # The coach declaring a finished 6-4 first set with the opponent to serve next: the
    # smallest complete board, and the one a test about the fold usually builds on.
    checkpoint = ScoreCheckpoint(
        **{
            "sequence": 0,
            "serves_next": MatchSide.OPPONENT,
            "order_changed": False,
            "after": {"sets": [snapshot_set()]},
        }
        | overrides
    )
    session.add(checkpoint)
    session.flush()
    return checkpoint


def checkpoint_payload(**overrides: Any) -> dict[str, Any]:
    """One checkpoint as the ingest endpoint receives it, the JSON twin of
    `make_score_checkpoint`'s row."""
    return {
        "id": str(uuid.uuid4()),
        "sequence": 0,
        "serves_next": "opponent",
        "order_changed": False,
        "after": {"sets": [snapshot_set()]},
    } | overrides
