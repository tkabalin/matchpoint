import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Match, Player
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.match import MatchCreate, MatchRead, MatchUpdate

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


# The 409 is declared because the roster screen branches on it: an archived player is a
# state the coach can undo, so the client says restore them first rather than reporting
# a failure. The 404 below stays undeclared, being nothing a caller can act on.
@router.post(
    "",
    status_code=201,
    response_model=MatchRead,
    responses={409: {"model": ErrorDetail, "description": "Player is archived"}},
)
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
    # 409 and not the 404 above: the coach can still read this player by id, so
    # answering as though it did not exist would misname the problem. Archiving stops
    # new matches; the ones already recorded stay listed and readable.
    if player.archived_at is not None:
        raise HTTPException(status_code=409, detail="Player is archived")
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


def match_for_coach(db: Session, match_id: uuid.UUID, coach_id: uuid.UUID) -> Match:
    """One coach's match by id, or a 404.

    Another coach's match gets the 404 an unknown id gets, not a 403: a 403 would
    confirm the id exists, and ids must stay unenumerable across coaches.
    """
    match = db.scalar(
        select(Match)
        .join(Player, Match.player_id == Player.id)
        .where(Match.id == match_id, Player.coach_id == coach_id)
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Match:
    return match_for_coach(db, match_id, coach.id)


@router.patch("/{match_id}", response_model=MatchRead)
def update_match(
    match_id: uuid.UUID, data: MatchUpdate, db: DbSession, coach: CurrentCoach
) -> Match:
    # Scoped through the player as get_match is, and 404 for the same reason.
    match = db.scalar(
        select(Match)
        .join(Player, Match.player_id == Player.id)
        .where(Match.id == match_id, Player.coach_id == coach.id)
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    # exclude_unset, so an absent field is left as it is and a null clears the column.
    # player_id is not on MatchUpdate, so the loop cannot move a match to another
    # player. updated_at is the column's onupdate, never set here.
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(match, field, value)
    db.commit()
    return match


@router.delete("/{match_id}", status_code=204)
def delete_match(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> None:
    # Hard-deleted rather than archived like a player: a match entered by mistake has no
    # history hanging off it. A table that comes to reference matches declares no
    # ondelete, so Postgres refuses to delete a match with point data behind it.
    db.delete(match_for_coach(db, match_id, coach.id))
    db.commit()
