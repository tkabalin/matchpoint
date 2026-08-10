"""Plain-function factories for building model rows in tests.

Rows are flush()ed, not committed, so they stay inside the test's rolled-back
transaction like everything else done through db_session.
"""

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from matchpoint_api.models import Match, Player


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
