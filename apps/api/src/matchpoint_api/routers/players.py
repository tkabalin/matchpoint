import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Player
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.player import PlayerCreate, PlayerRead, PlayerUpdate

# The 401 is declared once at the router because every route here requires a signed-in
# coach — current_coach reads the cookie off the request rather than declaring a
# Cookie() parameter, so no route's spec would carry it otherwise. Declared with a
# model so the client can route it to a login screen, per ErrorDetail's note. The 429
# is the per-coach budget current_coach charges, so it rides along for the same reason.
router = APIRouter(
    prefix="/players",
    tags=["players"],
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)

DbSession = Annotated[Session, Depends(get_db)]


def owned_player(db: Session, player_id: uuid.UUID, coach_id: uuid.UUID) -> Player:
    """The coach's player, or the 404 that keeps ids unenumerable across coaches."""
    player = db.get(Player, player_id)
    # Another coach's player gets the 404 an unknown id gets, not a 403: a 403 would
    # confirm the id exists.
    if player is None or player.coach_id != coach_id:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


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
def list_players(
    db: DbSession, coach: CurrentCoach, include_archived: bool = False
) -> list[Player]:
    # Archived players are hidden from the roster but still readable by id, so a
    # stored link or a match that references one does not break. The flag is what the
    # restore screen lists from: without it they are reachable only by remembered id.
    statement = select(Player).where(Player.coach_id == coach.id)
    if not include_archived:
        statement = statement.where(Player.archived_at.is_(None))
    return list(db.scalars(statement.order_by(Player.last_name, Player.first_name)))


@router.get("/{player_id}", response_model=PlayerRead)
def get_player(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Player:
    return owned_player(db, player_id, coach.id)


@router.post("/{player_id}/archive", response_model=PlayerRead)
def archive_player(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Player:
    player = owned_player(db, player_id, coach.id)
    # A second archive keeps the first timestamp: the offline client retries queued
    # requests, and a retry is not a second departure from the roster.
    if player.archived_at is None:
        # Python's clock, as in the auth routes' computed expiries. clock_timestamp()
        # belongs to the column defaults, where rows written in one transaction each
        # need a value of their own.
        player.archived_at = datetime.now(UTC)
        db.commit()
    return player


@router.post("/{player_id}/restore", response_model=PlayerRead)
def restore_player(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Player:
    player = owned_player(db, player_id, coach.id)
    # Restoring an active player is a no-op rather than a 409, for the reason archiving
    # twice is: a retried request must neither error nor move the row.
    if player.archived_at is not None:
        player.archived_at = None
        db.commit()
    return player


@router.patch("/{player_id}", response_model=PlayerRead)
def update_player(
    player_id: uuid.UUID, data: PlayerUpdate, db: DbSession, coach: CurrentCoach
) -> Player:
    player = owned_player(db, player_id, coach.id)
    # Every field PlayerUpdate carries is one a client may set, which is what makes
    # apply_to safe. updated_at is the column's onupdate, never set here.
    data.apply_to(player)
    db.commit()
    return player
