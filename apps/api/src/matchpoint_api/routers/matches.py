import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from matchpoint_api.db import get_db
from matchpoint_api.models import Match, Player
from matchpoint_api.schemas.match import MatchCreate, MatchRead

router = APIRouter(prefix="/matches", tags=["matches"])

DbSession = Annotated[Session, Depends(get_db)]


@router.post("", status_code=201, response_model=MatchRead)
def create_match(data: MatchCreate, db: DbSession) -> Match:
    # Checked here rather than left to the FK constraint so the client gets an error
    # naming the problem instead of a 500 from an IntegrityError. Not 422: FastAPI
    # declares that status as HTTPValidationError, whose detail is a list, and the
    # generated TypeScript client unpacks it as one.
    if db.get(Player, data.player_id) is None:
        raise HTTPException(status_code=404, detail="Unknown player_id")
    match = Match(**data.model_dump())
    db.add(match)
    db.commit()
    return match


@router.get("", response_model=list[MatchRead])
def list_matches(db: DbSession, player_id: uuid.UUID | None = None) -> list[Match]:
    # Filtering server-side rather than leaving it to the client: every analytics view
    # is one player's matches, which is what the index on Match.player_id is for, and
    # a coach's history is not a payload worth shipping whole to narrow it in the
    # browser. Optional, because the unfiltered list is the roster-wide recent
    # activity the dashboard opens on.
    statement = select(Match).order_by(Match.played_on.desc(), Match.created_at.desc())
    if player_id is not None:
        statement = statement.where(Match.player_id == player_id)
    return list(db.scalars(statement))


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: uuid.UUID, db: DbSession) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match
