"""Plain-function factories for building model rows in tests.

Rows are flush()ed, not committed, so they stay inside the test's rolled-back
transaction like everything else done through db_session.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from matchpoint_api.models import Coach, Match, Player


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
