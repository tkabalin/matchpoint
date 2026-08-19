import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Match, Player
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.match import MatchCreate, MatchRead, MatchUpdate

# The 401 is declared once at the router because every route here requires a signed-in
# coach — current_coach reads the cookie off the request rather than declaring a
# Cookie() parameter, so no route's spec would carry it otherwise. Declared with a
# model so the client can route it to a login screen, per ErrorDetail's note. The 429
# is the per-coach budget current_coach charges, so it rides along for the same reason.
#
# A match belongs to a coach only through its player — Match deliberately carries no
# coach_id of its own, which would be a second copy of a fact the player already
# states — so everything below scopes by joining through players.
router = APIRouter(
    prefix="/matches",
    tags=["matches"],
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)

DbSession = Annotated[Session, Depends(get_db)]


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


# The 404 below stays undeclared, being nothing a caller can act on.
@router.post("", status_code=201, response_model=MatchRead)
def create_match(data: MatchCreate, db: DbSession, coach: CurrentCoach) -> Match:
    # Checked here rather than left to the FK constraint so the client gets an error
    # naming the problem instead of a 500 from an IntegrityError. Not 422: FastAPI
    # declares that status as HTTPValidationError, whose detail is a list, and the
    # generated TypeScript client unpacks it as one. Another coach's player gets the
    # same 404 as no player at all — recording a match against one would be a write
    # across the ownership boundary, and a 403 would confirm the id exists.
    # Locked for the reason `owned_player` gives: DELETE /players/{id} can take the row
    # between an unlocked check and the insert, and the foreign key would answer that
    # with a 500 rather than the 404 below.
    player = db.get(Player, data.player_id, with_for_update=True)
    if player is None or player.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Unknown player_id")
    values = data.model_dump()
    if values["id"] is None:
        values["id"] = uuid.uuid4()
    # One statement, so two retries of the same offline match cannot both insert: the
    # loser waits on the row lock and reads back what the winner wrote. DO NOTHING takes
    # no lock, so it would return no row and a follow-up select could miss the winner's
    # uncommitted one. The no-op SET keeps the stored match, whatever a repeat body says.
    match = db.scalars(
        insert(Match)
        .values(**values)
        .on_conflict_do_update(index_elements=[Match.id], set_={"id": Match.id})
        .returning(Match)
    ).one()
    # The id already named a match, and not one of the player it was posted against, so
    # ownership has to be established through that match instead. This coach's own comes
    # back, the first write having won; another coach's gets the match routes' ordinary
    # 404, which reveals only that the id is taken, an unused one having been created.
    if match.player_id != player.id:
        match = match_for_coach(db, match.id, coach.id)
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
    return match_for_coach(db, match_id, coach.id)


@router.patch("/{match_id}", response_model=MatchRead)
def update_match(
    match_id: uuid.UUID, data: MatchUpdate, db: DbSession, coach: CurrentCoach
) -> Match:
    match = match_for_coach(db, match_id, coach.id)
    # player_id is not on MatchUpdate, so apply_to cannot move a match to another
    # player. updated_at is the column's onupdate, never set here.
    data.apply_to(match)
    db.commit()
    return match


@router.delete("/{match_id}", status_code=204)
def delete_match(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> None:
    # No cascade of its own, unlike deleting a player: a match entered by mistake has no
    # history hanging off it. A table that comes to reference matches declares no
    # ondelete, so Postgres refuses to delete a match with point data behind it.
    db.delete(match_for_coach(db, match_id, coach.id))
    db.commit()
