import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from matchpoint_api.db import get_db
from matchpoint_api.models import Player
from matchpoint_api.schemas.player import PlayerCreate, PlayerRead

router = APIRouter(prefix="/players", tags=["players"])

DbSession = Annotated[Session, Depends(get_db)]


@router.post("", status_code=201, response_model=PlayerRead)
def create_player(data: PlayerCreate, db: DbSession) -> Player:
    # PlayerCreate carries exactly the client-settable columns, which is what makes
    # the splat safe: coach_id and archived_at are not on it and so cannot be set here.
    player = Player(**data.model_dump())
    db.add(player)
    db.commit()
    return player


@router.get("", response_model=list[PlayerRead])
def list_players(db: DbSession) -> list[Player]:
    # Archived players are hidden from the roster but still readable by id, so a
    # stored link or a match that references one does not break.
    return list(
        db.scalars(
            select(Player)
            .where(Player.archived_at.is_(None))
            .order_by(Player.last_name, Player.first_name)
        )
    )


@router.get("/{player_id}", response_model=PlayerRead)
def get_player(player_id: uuid.UUID, db: DbSession) -> Player:
    player = db.get(Player, player_id)
    if player is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return player
