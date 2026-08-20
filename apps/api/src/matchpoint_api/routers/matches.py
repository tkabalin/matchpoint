import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import ForeignKeyViolation
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Match, Player
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.match import (
    MatchCaptureClaim,
    MatchCaptureRead,
    MatchCreate,
    MatchRead,
    MatchUpdate,
)

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

# Named so delete_match's route test can assert the body exactly, the way the
# transfer-code refusal on the player routes does.
MATCH_HAS_POINTS = "Match has recorded points"

# How long a capture claim stands without being renewed. Claiming again renews it, so
# this only bounds how long a device that has gone quiet keeps the match to itself: it
# outlasts any plausible match, because a device capturing offline cannot renew, and
# the release route frees a match sooner when a device is not coming back.
CAPTURE_CLAIM_TTL = timedelta(hours=4)


def match_for_coach(
    db: Session, match_id: uuid.UUID, coach_id: uuid.UUID, *, for_update: bool = False
) -> Match:
    """One coach's match by id, or a 404.

    Another coach's match gets the 404 an unknown id gets, not a 403: a 403 would
    confirm the id exists, and ids must stay unenumerable across coaches.
    `for_update` takes a row lock, which every route that reads the claim and then
    writes it needs: without it two requests read the same row and both write, so a
    second device wins a claim, or a finish clears one taken since it read.
    """
    statement = (
        select(Match)
        .join(Player, Match.player_id == Player.id)
        .where(Match.id == match_id, Player.coach_id == coach_id)
    )
    if for_update:
        # of=Match so the lock is on the row being written, not on the player joined
        # to prove ownership.
        statement = statement.with_for_update(of=Match)
    match = db.scalar(statement)
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


def capture_holder(match: Match) -> uuid.UUID | None:
    """The device capturing this match, or None while it is free to claim.

    A lapsed claim counts as free: a device that stops talking to the server never
    releases, so the deadline is what keeps an abandoned claim from locking the match
    for good. The point ingestion endpoint (#107) checks the holder through here too.
    """
    expires_at = match.capture_claim_expires_at
    if expires_at is None or expires_at <= datetime.now(UTC):
        return None
    return match.capture_claim_device_id


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Match:
    return match_for_coach(db, match_id, coach.id)


# The 409 is declared because the client branches on it: a recorded result closes the
# match to edits, so an edit screen has to send the coach to delete-and-re-record
# rather than retry.
@router.patch(
    "/{match_id}",
    response_model=MatchRead,
    responses={409: {"model": ErrorDetail, "description": "Match is completed"}},
)
def update_match(
    match_id: uuid.UUID, data: MatchUpdate, db: DbSession, coach: CurrentCoach
) -> Match:
    # Locked for the read like the capture routes: the completed check and the claim
    # clearing below both read then write, so an unlocked read lets a second result
    # land, and leaves a claim taken since the read standing.
    match = match_for_coach(db, match_id, coach.id, for_update=True)
    # A recorded result completes the match and locks it (#108). Re-sending the values
    # already stored is not an edit and answers 200: the client queues its writes
    # offline and retries them, and a retried finish must not come back as a failure.
    if match.result is not None and any(
        getattr(match, field) != value
        for field, value in data.model_dump(exclude_unset=True).items()
    ):
        raise HTTPException(status_code=409, detail="Match is completed")
    # player_id is not on MatchUpdate, so apply_to cannot move a match to another
    # player. updated_at is the column's onupdate, never set here.
    data.apply_to(match)
    if match.result is not None:
        # Finishing the match ends capture, so the claim goes with it rather than
        # standing until it lapses over a match nothing can capture.
        match.capture_claim_device_id = None
        match.capture_claim_expires_at = None
    db.commit()
    return match


# One 409 covering both refusals, distinguished by its message: either way the answer
# is that capture cannot start here, and a client branching on the wording would be
# reading a sentence rather than a status.
@router.post(
    "/{match_id}/capture",
    response_model=MatchCaptureRead,
    responses={409: {"model": ErrorDetail, "description": "Match cannot be captured"}},
)
def claim_capture(
    match_id: uuid.UUID, data: MatchCaptureClaim, db: DbSession, coach: CurrentCoach
) -> MatchCaptureRead:
    """Claim a match for capture on this device, or renew a claim it already holds."""
    match = match_for_coach(db, match_id, coach.id, for_update=True)
    if match.result is not None:
        raise HTTPException(status_code=409, detail="Match is completed")
    holder = capture_holder(match)
    if holder is not None and holder != data.device_id:
        raise HTTPException(status_code=409, detail="Match is being captured on another device")
    match.capture_claim_device_id = data.device_id
    expires_at = datetime.now(UTC) + CAPTURE_CLAIM_TTL
    match.capture_claim_expires_at = expires_at
    db.commit()
    return MatchCaptureRead(device_id=data.device_id, expires_at=expires_at)


@router.post("/{match_id}/capture/release", status_code=204)
def release_capture(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> None:
    """Free a match for capture on another device."""
    # Any of the coach's devices may release, and the request names none: the device
    # that mattered is often the one that cannot ask (flat battery, app gone), and a
    # coach moving to their tablet mid-match needs a way through that does not wait
    # out the claim. Releasing a match nobody holds is a no-op, so a retry is safe.
    match = match_for_coach(db, match_id, coach.id, for_update=True)
    if match.capture_claim_device_id is not None:
        match.capture_claim_device_id = None
        match.capture_claim_expires_at = None
        db.commit()


# The 409 is declared because the client branches on it: a match with points recorded
# cannot be cleared away and re-entered the way an empty one can, so the coach is told
# why rather than left to read a generic failure.
@router.delete(
    "/{match_id}",
    status_code=204,
    responses={409: {"model": ErrorDetail, "description": MATCH_HAS_POINTS}},
)
def delete_match(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> None:
    # Derived set rows follow the match out through their own ondelete; the points
    # table declares none, so a match with real capture history refuses the delete
    # instead of losing it. Deleting the player, or closing the account, is the only
    # way past a match that has points recorded against it.
    db.delete(match_for_coach(db, match_id, coach.id))
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        # Narrows the type for Pyright, and keeps any other integrity failure out of a
        # 409 about points. `points` is the only inbound key that refuses rather than
        # cascading, so a second one has to narrow further than the violation class.
        if isinstance(exc.orig, ForeignKeyViolation):
            raise HTTPException(status_code=409, detail=MATCH_HAS_POINTS) from exc
        raise
    db.commit()
