import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Player
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.player import PlayerCreate, PlayerRead

# The 401 is declared once at the router because every route here requires a signed-in
# coach — current_coach reads the cookie off the request rather than declaring a
# Cookie() parameter, so no route's spec would carry it otherwise. Declared with a
# model so the client can route it to a login screen, per ErrorDetail's note.
router = APIRouter(
    prefix="/players",
    tags=["players"],
    responses={401: {"model": ErrorDetail, "description": "Not signed in"}},
)

DbSession = Annotated[Session, Depends(get_db)]


@router.post("", status_code=201, response_model=PlayerRead)
def create_player(data: PlayerCreate, db: DbSession, coach: CurrentCoach) -> Player:
    # PlayerCreate carries exactly the client-settable columns, which is what makes
    # the splat safe: coach_id and archived_at are not on it and so cannot be set
    # here. Ownership comes from the session instead, never from the body.
    player = Player(**data.model_dump(), coach_id=coach.id)
    db.add(player)
    db.commit()
    return player


@router.get("", response_model=list[PlayerRead])
def list_players(db: DbSession, coach: CurrentCoach) -> list[Player]:
    # Archived players are hidden from the roster but still readable by id, so a
    # stored link or a match that references one does not break.
    return list(
        db.scalars(
            select(Player)
            .where(Player.coach_id == coach.id, Player.archived_at.is_(None))
            .order_by(Player.last_name, Player.first_name)
        )
    )


@router.get("/{player_id}", response_model=PlayerRead)
def get_player(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Player:
    player = db.get(Player, player_id)
    # Another coach's player gets the 404 an unknown id gets, not a 403: a 403 would
    # confirm the id exists, and ids must stay unenumerable across coaches.
    if player is None or player.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Player not found")
    return player
