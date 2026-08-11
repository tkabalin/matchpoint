"""Plain-function factories for building model rows in tests.

Rows are flush()ed, not committed, so they stay inside the test's rolled-back
transaction like everything else done through db_session.
"""

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from matchpoint_api.models import Coach, CoachSession, Match, Player


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


def make_player(session: Session, **overrides: Any) -> Player:
    player = Player(**{"first_name": "Test", "last_name": "Player"} | overrides)
    session.add(player)
    session.flush()
    return player


def make_match(session: Session, **overrides: Any) -> Match:
    if "player_id" not in overrides:
        overrides["player_id"] = make_player(session).id
    match = Match(**{"played_on": date(2026, 8, 1)} | overrides)
    session.add(match)
    session.flush()
    return match
