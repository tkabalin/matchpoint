import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import UniqueViolation
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach, CurrentPrincipal
from matchpoint_api.db import get_db
from matchpoint_api.match_sets import recompute_match_sets
from matchpoint_api.models import Coach, DeletedMatch, Match, MatchSet, Player, Point
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.match import (
    MatchCaptureClaim,
    MatchCaptureRead,
    MatchCreate,
    MatchInProgressRead,
    MatchRead,
    MatchSetRead,
    MatchUpdate,
)
from matchpoint_api.schemas.point import PointBatch, PointRead

# The 401 is declared once at the router because every route here requires a session:
# the resolving dependency reads the cookie off the request rather than declaring a
# Cookie() parameter, so no route's spec would carry it otherwise. Declared with a
# model so the client can route it to a login screen, per ErrorDetail's note. The 429
# is the per-principal budget that dependency charges, so it rides along for the same
# reason.
#
# The two read routes below take either principal: a coach reads their roster's
# matches, a player their own. Everything else here is a write or is roster-wide, and
# stays coach-only.
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

# Named so a route test can assert the body exactly, the way the transfer-code refusal
# on the player routes does.
MATCH_NOT_FOUND = "Match not found"
MATCH_IS_BEING_CAPTURED = "Match is being captured on another device"
MATCH_WAS_DELETED = "Match was deleted"
COMPLETED_MATCH_IS_LOCKED = "A completed match's result and scoring system cannot be changed"
POINT_SEQUENCE_TAKEN = "A different point already holds that sequence"
POINT_IN_ANOTHER_MATCH = "A point in this batch is already stored against another match"

# How long a capture claim stands without being renewed. Claiming again renews it, so
# this only bounds how long a device that has gone quiet keeps the match to itself: it
# outlasts any plausible match, because a device capturing offline cannot renew, and
# the release route frees a match sooner when a device is not coming back.
CAPTURE_CLAIM_TTL = timedelta(hours=4)

# How long a deleted match's id refuses a write naming it. Sized to the outbox and not to
# the capture claim: what has to elapse is a device finishing with its unsent rows, and
# ingest_points already takes the backlog of a device whose claim lapsed while it was
# away. 30 days is auth.py's SESSION_LIFETIME, the figure already chosen here for how long
# an app left alone stays live. Expiry is lazy: an aged row stops matching (#214).
DELETED_MATCH_TTL = timedelta(days=30)

# What completing a match freezes (#228). The result is the completion signal itself, and
# the scoring system is the rulebook the client scored the points under (the server only
# stores the label, `docs/scoring-systems.md`), so moving it relabels a match already
# played. The descriptive fields reach analytics too, played_on splitting the year and
# opponent_name keying a matchup, but correcting one fixes those figures rather than
# rewriting them, which is what keeps a typo cheaper than the match and its points.
COMPLETION_LOCKED_FIELDS = ("result", "scoring_system")


def match_for_coach(
    db: Session, match_id: uuid.UUID, coach_id: uuid.UUID, *, for_update: bool = False
) -> Match:
    """One coach's match by id, or a 404.

    Another coach's match gets the 404 an unknown id gets, not a 403: a 403 would
    confirm the id exists, and ids must stay unenumerable across coaches.
    `for_update` takes a row lock, which every route that reads the claim and then
    writes the row needs: without it two requests read the same row and both write, so a
    second device wins a claim, a finish clears one taken since it read, or a delete
    takes a match claimed while it waited.
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
        raise HTTPException(status_code=404, detail=MATCH_NOT_FOUND)
    return match


def readable_match(db: Session, match_id: uuid.UUID, principal: Coach | Player) -> Match:
    """One match this principal may read: the coach's own, or the player's own.

    The player's scope needs no join, a match naming their id being theirs by
    definition, and anything else answers the 404 another coach's match answers.
    Reads only, and unlocked: every route that writes takes a coach and a row lock.
    """
    if isinstance(principal, Player):
        match = db.scalar(
            select(Match).where(Match.id == match_id, Match.player_id == principal.id)
        )
        if match is None:
            raise HTTPException(status_code=404, detail=MATCH_NOT_FOUND)
        return match
    return match_for_coach(db, match_id, principal.id)


def deleted_within_window(db: Session, match_id: uuid.UUID) -> bool:
    """Whether a delete of this id is recent enough to still refuse a write naming it.

    Expiry is compared here rather than in the statement, the lazy way `capture_holder`
    reads a claim, so an aged row stops matching instead of being swept.
    """
    deleted_at = db.scalar(select(DeletedMatch.deleted_at).where(DeletedMatch.id == match_id))
    return deleted_at is not None and deleted_at > datetime.now(UTC) - DELETED_MATCH_TTL


def match_for_write(db: Session, match_id: uuid.UUID, coach_id: uuid.UUID) -> Match:
    """One coach's match, locked for a write, or a 410 where the coach deleted it.

    The tombstone is read where the locked read comes back empty rather than before it: a
    delete that committed while this statement waited on the row it had locked is in no
    earlier read's snapshot, so a 404 there parks a row for a match the coach asked to be
    rid of (#214). Nothing is lost by checking only here, an in-window tombstone refusing
    every create of that id, so no match that still exists has one.
    """
    try:
        return match_for_coach(db, match_id, coach_id, for_update=True)
    except HTTPException:
        # The 404 is match_for_coach's only refusal, and it cannot tell a deleted match
        # from one that never existed: only the tombstone says the coach asked for it.
        if deleted_within_window(db, match_id):
            raise HTTPException(status_code=410, detail=MATCH_WAS_DELETED) from None
        raise


# The 410 is declared because the client branches on it: a match the coach deleted is
# the one refusal where a queued create is destroyed rather than shown to them, so the
# sync layer needs a status of its own for it (#214). The 404s stay undeclared, being the
# same dead end whatever caused them and one the coach did not ask for: a player
# transferred to another roster answers it too, so a client discarding on 404 would erase
# a match whose only fault was naming a player who has moved.
@router.post(
    "",
    status_code=201,
    response_model=MatchRead,
    responses={410: {"model": ErrorDetail, "description": "Match was deleted"}},
)
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
        # Deleting a player tombstones each of their matches (#243), and this 404 cannot
        # tell one of those from a player who never existed. Read after the locked player
        # read, as below: a delete committing during the wait is in no earlier snapshot.
        if data.id is not None and deleted_within_window(db, data.id):
            raise HTTPException(status_code=410, detail=MATCH_WAS_DELETED)
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
    # Read after the insert rather than before it, as ingest_points reads its stray ids: a
    # delete committing while this statement waited on the row it had locked would take
    # that row, leaving the upsert to insert it again.
    if deleted_within_window(db, match.id):
        db.rollback()
        raise HTTPException(status_code=410, detail=MATCH_WAS_DELETED)
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
    db: DbSession, principal: CurrentPrincipal, player_id: uuid.UUID | None = None
) -> list[Match]:
    # Filtering server-side rather than leaving it to the client: every analytics view
    # is one player's matches, which is what the index on Match.player_id is for, and
    # a coach's history is not a payload worth shipping whole to narrow it in the
    # browser. Optional, because the unfiltered list is the roster-wide recent
    # activity the dashboard opens on. The scope join costs that query nothing it
    # wasn't paying: the player_id filter still hits ix_matches_player_id, and the
    # join resolves each player by primary key.
    statement = select(Match)
    if isinstance(principal, Player):
        # A player's own matches name their id, so their scope is the column the
        # coach's join arrives at anyway.
        statement = statement.where(Match.player_id == principal.id)
    else:
        statement = statement.join(Player, Match.player_id == Player.id).where(
            Player.coach_id == principal.id
        )
    if player_id is not None:
        # Narrows a scope, never widens one: a player naming someone else gets the
        # empty list an unknown id gets, which confirms nothing about either.
        statement = statement.where(Match.player_id == player_id)
    return list(db.scalars(statement.order_by(Match.played_on.desc(), Match.created_at.desc())))


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


# Declared above the /{match_id} routes because Starlette matches in declaration order
# and that path parameter would take "in-progress" itself, answering 422 rather than
# falling through to here.
@router.get("/in-progress", response_model=list[MatchInProgressRead])
def list_in_progress_matches(db: DbSession, coach: CurrentCoach) -> list[MatchInProgressRead]:
    """Every match of this coach's that capture is under way on, freshest claim first.

    Coach-scoped though the claim names a device: the resume banner is chrome on every
    screen, so a coach who left capture running on their phone needs the tablet to say
    so, which is exactly the answer a device filter would blank. A list rather than one
    match because two devices can hold two matches at once, and the banner takes the
    first.
    """
    # capture_holder's test for a live claim, in SQL: a lapsed claim is a device that
    # went quiet, which the banner must not offer to resume. A null deadline fails the
    # comparison, so a match nobody has claimed drops out with it.
    rows = db.execute(
        select(
            Match.id,
            Match.player_id,
            Player.first_name,
            Player.last_name,
            Match.opponent_name,
        )
        .join(Player, Match.player_id == Player.id)
        .where(
            Player.coach_id == coach.id,
            Match.result.is_(None),
            Match.capture_claim_expires_at > datetime.now(UTC),
        )
        .order_by(Match.capture_claim_expires_at.desc())
    )
    return [
        MatchInProgressRead(
            id=row.id,
            player_id=row.player_id,
            player_first_name=row.first_name,
            player_last_name=row.last_name,
            opponent_name=row.opponent_name,
        )
        for row in rows
    ]


@router.get("/{match_id}", response_model=MatchRead)
def get_match(match_id: uuid.UUID, db: DbSession, principal: CurrentPrincipal) -> Match:
    return readable_match(db, match_id, principal)


# The 409 is declared because the client branches on it: a completed match refuses a
# change to either locked field, so an edit screen offers those two only while they are
# still unset rather than as controls whose save will always fail. The 410 beside it is
# declared as it is on the ingest route, and covers the one refusal a queued edit is
# discarded on rather than parked: the coach deleted the match it names (#214).
@router.patch(
    "/{match_id}",
    response_model=MatchRead,
    responses={
        409: {
            "model": ErrorDetail,
            "description": "A completed match's result or scoring system cannot be changed",
        },
        410: {"model": ErrorDetail, "description": "Match was deleted"},
    },
)
def update_match(
    match_id: uuid.UUID, data: MatchUpdate, db: DbSession, coach: CurrentCoach
) -> Match:
    # Locked for the read like the capture routes: the completed check and the claim
    # clearing below both read then write, so an unlocked read lets a second result
    # land, and leaves a claim taken since the read standing. A queued finish flushed
    # after a delete on another device is what the 410 from that read answers.
    match = match_for_write(db, match_id, coach.id)
    submitted = data.model_dump(exclude_unset=True)
    # A recorded result completes the match (#108) and freezes the locked fields alone
    # (#228). A field still null has never been set, so it can be filled in afterwards,
    # the way the result itself was. Re-sending a value already stored is not an edit
    # and answers 200: the client queues its writes offline and retries them, and a
    # retried finish must not come back as a failure.
    if match.result is not None and any(
        submitted[field] != getattr(match, field)
        for field in COMPLETION_LOCKED_FIELDS
        if field in submitted and getattr(match, field) is not None
    ):
        raise HTTPException(status_code=409, detail=COMPLETED_MATCH_IS_LOCKED)
    # player_id is not on MatchUpdate, so apply_to cannot move a match to another
    # player. updated_at is the column's onupdate, never set here.
    data.apply_to(match)
    if match.result is not None:
        # Finishing the match ends capture, so the claim goes with it rather than
        # standing until it lapses over a match nothing can capture. A metadata edit on
        # an already-complete match re-clears two null columns, which is no write at all.
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
        raise HTTPException(status_code=409, detail=MATCH_IS_BEING_CAPTURED)
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


# One 409 covering every refusal below, as on the capture claim: whichever it is, this
# batch will never be ingestable, so the sync layer parks it instead of retrying, and it
# can read that off the status without parsing the sentence. The 410 beside it is
# declared for the same reason and covers the one case where the batch is discarded
# rather than parked: the coach deleted the match it was captured against (#214).
@router.post(
    "/{match_id}/points",
    response_model=list[MatchSetRead],
    responses={
        409: {"model": ErrorDetail, "description": "Points cannot be ingested"},
        410: {"model": ErrorDetail, "description": "Match was deleted"},
    },
)
def ingest_points(
    match_id: uuid.UUID, data: PointBatch, db: DbSession, coach: CurrentCoach
) -> list[MatchSet]:
    """Ingest one flush of captured points, answering with the match's set scores.

    All or nothing: the batch lands whole or none of it does, and a point already
    stored is left as it is rather than rewritten, so a retried or overlapping flush
    converges instead of failing. `points` carries the batch's own ceiling, and the
    1 MB request body limit is the real bound, which a batch of points carrying long
    notes reaches sooner.
    """
    # Locked because this reads the result and the claim and then writes points
    # against them, and because delete_match deletes the points and then the match:
    # unlocked, a batch could land under a delete that had already erased its points.
    match = match_for_write(db, match_id, coach.id)
    if match.result is not None:
        raise HTTPException(status_code=409, detail="Match is completed")
    # A flush is evidence the holder is still capturing, so it renews the claim as
    # claiming again does. Any other device's batch is still ingested: a device
    # capturing offline cannot renew, and refusing the backlog of a claim that lapsed
    # while it was away would strand points that were genuinely played.
    if capture_holder(match) == data.device_id:
        match.capture_claim_expires_at = datetime.now(UTC) + CAPTURE_CLAIM_TTL
    try:
        # One statement, and DO NOTHING on the client's own id: a point is immutable
        # once ingested, so a repeat is the point we already hold, whatever the second
        # body says about it. No follow-up read needs the row, which is what create_match
        # takes a lock through DO UPDATE for.
        db.execute(
            insert(Point)
            .values([{"match_id": match.id, **point.model_dump()} for point in data.points])
            .on_conflict_do_nothing(index_elements=[Point.id])
        )
    except IntegrityError as exc:
        db.rollback()
        # A different point already holds that sequence, which two devices capturing one
        # match produce, and no retry will clear. The whole batch is refused: there are
        # no per-item results to report a single bad point through.
        if isinstance(exc.orig, UniqueViolation):
            raise HTTPException(status_code=409, detail=POINT_SEQUENCE_TAKEN) from exc
        raise
    # An id already stored against another match takes that DO NOTHING branch, so
    # without this the point is dropped and the flush still answers 200. Read after the
    # insert rather than before, which is what closes the gap a concurrent flush leaves.
    stray = db.scalar(
        select(Point.id).where(
            Point.id.in_([point.id for point in data.points]), Point.match_id != match.id
        )
    )
    if stray is not None:
        db.rollback()
        raise HTTPException(status_code=409, detail=POINT_IN_ANOTHER_MATCH)
    sets = recompute_match_sets(db, match.id)
    db.commit()
    return sets


@router.get("/{match_id}/points", response_model=list[PointRead])
def list_points(match_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> list[Point]:
    """A match's points, in the order the capture client assigned them.

    Feeds two readers: the analytics dashboard aggregating over rally outcomes and
    serve placement, and the capture client reconciling its local outbox against what
    the server holds after a sync. A pure read, so match_for_coach takes no lock.
    """
    match = match_for_coach(db, match_id, coach.id)
    return list(
        db.scalars(select(Point).where(Point.match_id == match.id).order_by(Point.sequence))
    )


# The 409 is declared because the client branches on it, and it now covers the one
# refusal left: another device is capturing the match. Points recorded against it were a
# second until #214, so the coach-facing delete reads the reason off the status alone.
@router.delete(
    "/{match_id}",
    status_code=204,
    responses={409: {"model": ErrorDetail, "description": "Match is being captured"}},
)
def delete_match(
    match_id: uuid.UUID, db: DbSession, coach: CurrentCoach, device_id: uuid.UUID | None = None
) -> None:
    """Erase one match and the points captured against it, unless another device holds it.

    `device_id` names the asking device, so the device holding the capture claim can
    still delete the match it is capturing. A player's analytics change retroactively and
    that is the intent: a match started against the wrong player skews every statistic it
    is counted in until it goes.
    """
    # Locked for the reason the claim routes give: an unlocked read lets a claim taken
    # while it waited stand through the delete below.
    match = match_for_coach(db, match_id, coach.id, for_update=True)
    # The holder is exempt because backing out of capture does not release its claim
    # (#197), so refusing over every one would lock a match set up by mistake away for
    # the rest of the four hours.
    holder = capture_holder(match)
    if holder is not None and holder != device_id:
        raise HTTPException(status_code=409, detail=MATCH_IS_BEING_CAPTURED)
    # The points go by hand and in this transaction, as the player delete and account
    # closure already erase them: `points.match_id` declares no `ondelete`, so a match
    # still holding any would refuse the delete outright. The derived set rows follow it
    # out through the schema's one cascade instead.
    db.execute(delete(Point).where(Point.match_id == match.id))
    # The id is remembered for as long as a create queued elsewhere could still name it,
    # so flushing an already-acknowledged create cannot put the match back. DO UPDATE
    # because an id the window has freed can be used again, and deleted again.
    db.execute(
        insert(DeletedMatch)
        .values(id=match.id, coach_id=coach.id)
        .on_conflict_do_update(
            index_elements=[DeletedMatch.id],
            set_={"deleted_at": func.clock_timestamp(), "coach_id": coach.id},
        )
    )
    db.delete(match)
    db.commit()
