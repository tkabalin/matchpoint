import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Match, Player
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.match import MatchCreate, MatchRead

# The 401 is declared once at the router because every route here requires a signed-in
# coach — current_coach reads the cookie off the request rather than declaring a
# Cookie() parameter, so no route's spec would carry it otherwise. Declared with a
# model so the client can route it to a login screen, per ErrorDetail's note.
#
# A match belongs to a coach only through its player — Match deliberately carries no
# coach_id of its own, which would be a second copy of a fact the player already
# states — so everything below scopes by joining through players.
router = APIRouter(
    prefix="/matches",
    tags=["matches"],
    responses={401: {"model": ErrorDetail, "description": "Not signed in"}},
)

DbSession = Annotated[Session, Depends(get_db)]


@router.post("", status_code=201, response_model=MatchRead)
def create_match(data: MatchCreate, db: DbSession, coach: CurrentCoach) -> Match:
    # Checked here rather than left to the FK constraint so the client gets an error
    # naming the problem instead of a 500 from an IntegrityError. Not 422: FastAPI
    # declares that status as HTTPValidationError, whose detail is a list, and the
    # generated TypeScript client unpacks it as one. Another coach's player gets the
    # same 404 as no player at all — recording a match against one would be a write
    # across the ownership boundary, and a 403 would confirm the id exists.
    player = db.get(Player, data.player_id)
    if player is None or player.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Unknown player_id")
    match = Match(**data.model_dump())
    db.add(match)
    db.commit()
    return match


@router.get("", response_model=list[MatchRead])
def list_matches(
    db: DbSession, coach: CurrentCoach, player_id: uuid.UUID | None = None
) -> list[Match]:
    # Filtering server-side rather than leaving it to the client: every analytics view
    # is one player's matches, which is what the index on Match.player_id is for, and
    # a coach's history is not a payload worth shipping whole to narrow it in the
    # browser. Optional, because the unfiltered list is the roster-wide recent
    # activity the dashboard opens on. The scope join costs that query nothing it
    # wasn't paying: the player_id filter still hits ix_matches_player_id, and the
    # join resolves each player by primary key.
    statement = (
        select(Match)
        .join(Player, Match.player_id == Player.id)
        .where(Player.coach_id == coach.id)
        .order_by(Match.played_on.desc(), Match.created_at.desc())
    )
    if player_id is not None:
        statement = statement.where(Match.player_id == player_id)
    return list(db.scalars(statement))


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Match:
    # Another coach's match gets the 404 an unknown id gets, not a 403: a 403 would
    # confirm the id exists, and ids must stay unenumerable across coaches.
    match = db.scalar(
        select(Match)
        .join(Player, Match.player_id == Player.id)
        .where(Match.id == match_id, Player.coach_id == coach.id)
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match
