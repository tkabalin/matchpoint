import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from matchpoint_api import photos
from matchpoint_api.auth import CurrentCoach, hash_token, new_session_token
from matchpoint_api.db import get_db
from matchpoint_api.models import Match, Player, PlayerTransferCode
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.player import (
    PlayerCreate,
    PlayerRead,
    PlayerTransferCodeRead,
    PlayerUpdate,
    RedeemTransferCodeRequest,
)

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

# One message for both routes that can destroy a player, the delete below and account
# closure, which imports it: a live code means the same thing to each of them.
TRANSFER_CODES_OUTSTANDING = "Outstanding transfer codes must be cancelled or redeemed first"


def owned_player(
    db: Session, player_id: uuid.UUID, coach_id: uuid.UUID, *, for_update: bool = False
) -> Player:
    """The coach's player, or the 404 that keeps ids unenumerable across coaches.

    Every route that goes on to write passes `for_update`: `coach_id` moves when a
    transfer code is redeemed, so an ownership check read without the row lock can be
    stale by the time the write lands, and Postgres would apply it anyway.

    `populate_existing` because the suite's client shares one session across requests,
    where a cached instance would answer `has_transfer_code` with whatever an earlier read
    computed. A production request gets its own session, so nothing there is overwritten.
    """
    player = db.get(Player, player_id, populate_existing=True, with_for_update=for_update)
    # Another coach's player gets the 404 an unknown id gets, not a 403: a 403 would
    # confirm the id exists.
    if player is None or player.coach_id != coach_id:
        raise HTTPException(status_code=404, detail="Player not found")
    return player


@router.post("", status_code=201, response_model=PlayerRead)
def create_player(data: PlayerCreate, db: DbSession, coach: CurrentCoach) -> Player:
    # PlayerCreate carries exactly the client-settable columns, which is what makes
    # the splat safe: coach_id is not on it and so cannot be set here. Ownership comes
    # from the session instead, never from the body.
    player = Player(**data.model_dump(), coach_id=coach.id)
    db.add(player)
    db.commit()
    return player


@router.get("", response_model=list[PlayerRead])
def list_players(db: DbSession, coach: CurrentCoach) -> list[Player]:
    statement = select(Player).where(Player.coach_id == coach.id)
    return list(db.scalars(statement.order_by(Player.last_name, Player.first_name)))


@router.get("/{player_id}", response_model=PlayerRead)
def get_player(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Player:
    return owned_player(db, player_id, coach.id)


@router.patch("/{player_id}", response_model=PlayerRead)
def update_player(
    player_id: uuid.UUID, data: PlayerUpdate, db: DbSession, coach: CurrentCoach
) -> Player:
    player = owned_player(db, player_id, coach.id, for_update=True)
    # Every field PlayerUpdate carries is one a client may set, which is what makes
    # apply_to safe. updated_at is the column's onupdate, never set here.
    data.apply_to(player)
    db.commit()
    return player


# Declared because the roster screen branches on it: an outstanding code is a state the
# coach can clear, so the client offers to cancel it rather than reporting a failure.
@router.delete(
    "/{player_id}",
    status_code=204,
    responses={409: {"model": ErrorDetail, "description": TRANSFER_CODES_OUTSTANDING}},
)
def delete_player(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> None:
    """Erase this player and every match recorded against them. Nothing undoes it.

    No confirmation beyond the request itself. What the coach is about to lose is on the
    screen in front of them, so confirming it belongs to the client rather than to a
    second round trip taken courtside.
    """
    player = owned_player(db, player_id, coach.id, for_update=True)
    # A live code is another coach's pending claim, which is why account closure refuses
    # over one too. Agreeing with that refusal is what stops it being sidestepped a
    # player at a time; `DELETE /players/{id}/transfer-code` is the way past it. Read off
    # the same predicate the roster shows, so the two cannot disagree.
    #
    # Expired so the check reads after the row lock rather than in the statement that
    # takes it: that statement's snapshot predates the wait for the lock, so a mint which
    # committed during the wait would not be in it.
    db.expire(player, ["has_transfer_code"])
    if player.has_transfer_code:
        raise HTTPException(status_code=409, detail=TRANSFER_CODES_OUTSTANDING)
    # Children first, in one transaction, for the reason account closure gives: a table
    # added below players and left out of this list stops the delete outright rather than
    # orphaning rows, no foreign key here declaring an `ondelete`. The derived set rows
    # under a match are the one exception, and follow their match out on their own.
    photo_key = player.photo_key
    db.execute(delete(Match).where(Match.player_id == player.id))
    db.delete(player)
    db.commit()
    # After the commit, as everywhere else a row and a file change together: the row is
    # gone either way, and a file left behind costs disk, not correctness.
    photos.delete(photo_key)


# A photo is set and cleared by its own endpoints rather than through PATCH, because a
# client cannot name a URL it does not own: what it sends is bytes, and what it gets back
# is where they ended up. Both answer with the whole player, since a new photo is stored
# under a new key and the response is the only place the caller learns it.


@router.post(
    "/{player_id}/photo",
    response_model=PlayerRead,
    responses={400: {"model": ErrorDetail, "description": photos.PHOTO_REFUSED}},
)
def upload_player_photo(
    player_id: uuid.UUID,
    file: Annotated[UploadFile, File()],
    db: DbSession,
    coach: CurrentCoach,
    request: Request,
) -> Player:
    """Replace this player's photo, and answer with the player."""
    photos.limit_photo_upload_rate(request, coach.id)
    # Ownership checked unlocked first, so a probe at another coach's id gets its 404
    # having stored nothing — then the transaction is ended, so the connection isn't
    # pinned across the semaphore wait inside store_photo below. The row lock is taken
    # only around the write, which is the part that actually needs it.
    owned_player(db, player_id, coach.id)
    db.rollback()
    new_key = photos.store_photo(file)
    player = owned_player(db, player_id, coach.id, for_update=True)
    photos.replace_key(db, player, new_key)
    return player


@router.delete("/{player_id}/photo", response_model=PlayerRead)
def delete_player_photo(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> Player:
    """Clear this player's photo, back to the initials avatar the app falls back to."""
    player = owned_player(db, player_id, coach.id, for_update=True)
    # Clearing a photo that is not there is a no-op rather than a 404, for the reason
    # archiving twice is: a retried request must neither error nor move the row.
    if player.photo_key is not None:
        photos.replace_key(db, player, None)
    return player


# Transferring a player (#173): players change coach as they grow up, and the roster is
# coach-scoped, so without this the history a new coach most needs is the history they
# cannot see. The code is the whole authorisation, handed over out of band, so the two
# coaches never need accounts that know about each other.

UNKNOWN_TRANSFER_CODE = "That transfer code is unknown or has already been used"
ALREADY_OWNED = "That player is already on your roster"


@router.post("/{player_id}/transfer-code", status_code=201, response_model=PlayerTransferCodeRead)
def create_player_transfer_code(
    player_id: uuid.UUID, db: DbSession, coach: CurrentCoach
) -> PlayerTransferCodeRead:
    """Mint a code that hands this player, their notes and their matches, to another coach.

    Asking again replaces the previous code, which the storage decides rather than the
    policy: only a hash is kept, so an earlier code can never be shown a second time.
    """
    player = owned_player(db, player_id, coach.id, for_update=True)
    code = new_session_token()
    fresh = {"token_hash": hash_token(code)}
    # An upsert rather than insert-or-update in Python, as at request-otp: the loser of a
    # concurrent INSERT must overwrite rather than raise, so one player never holds two
    # live codes. updated_at by hand because ON CONFLICT is an INSERT to SQLAlchemy, so
    # the column's onupdate never fires for it.
    db.execute(
        insert(PlayerTransferCode)
        .values(player_id=player.id, **fresh)
        .on_conflict_do_update(
            index_elements=[PlayerTransferCode.player_id],
            set_={**fresh, "updated_at": func.clock_timestamp()},
        )
    )
    db.commit()
    return PlayerTransferCodeRead(code=code)


@router.delete("/{player_id}/transfer-code", status_code=204)
def delete_player_transfer_code(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> None:
    """Cancel an outstanding code, so a copy of it stops working.

    A code that never expires needs a way back, since handing one to the wrong person is
    otherwise permanent. 204 whether or not one was outstanding, as logout is: the request
    asks for a state, and a player with no live code is already in it.
    """
    player = owned_player(db, player_id, coach.id, for_update=True)
    db.execute(delete(PlayerTransferCode).where(PlayerTransferCode.player_id == player.id))
    db.commit()


# Both statuses are declared because the redeem form branches on each: a 400 sends the
# coach back to the code field, and a 409 says the transfer already happened rather than
# reporting a failure. Declared with a model for ErrorDetail's reason.
@router.post(
    "/redeem-transfer-code",
    response_model=PlayerRead,
    responses={
        400: {"model": ErrorDetail, "description": UNKNOWN_TRANSFER_CODE},
        409: {"model": ErrorDetail, "description": ALREADY_OWNED},
    },
)
def redeem_player_transfer_code(
    data: RedeemTransferCodeRequest, db: DbSession, coach: CurrentCoach
) -> Player:
    """Take the player a transfer code names onto this coach's roster, matches included.

    The code is spent here, so presenting it again answers 400. The match history needs no
    rewriting: a match reaches its owner through its player, so it moves with them.
    """
    # Stripped because the code arrives pasted out of a message, where a trailing space or
    # newline rides along and would otherwise read as a wrong code.
    token_hash = hash_token(data.code.get_secret_value().strip())
    # One query for the code and its player, as current_coach loads a session and its
    # coach: the join can never drop a live row, the foreign key guaranteeing the player.
    # FOR UPDATE on the code row leaves two simultaneous redemptions a single winner:
    # the second waits, then re-checks its WHERE against the row the first deleted and
    # matches nothing, so it takes the 400 below rather than claiming the player too.
    row = db.execute(
        select(PlayerTransferCode, Player)
        .join(Player, PlayerTransferCode.player_id == Player.id)
        .where(PlayerTransferCode.token_hash == token_hash)
        .with_for_update(of=PlayerTransferCode)
    ).first()
    if row is None:
        raise HTTPException(status_code=400, detail=UNKNOWN_TRANSFER_CODE)
    # _tuple() rather than unpacking the Row, for the reason verify_otp gives: it is what
    # keeps these two typed instead of Any.
    transfer, player = row._tuple()
    if player.coach_id == coach.id:
        # Nothing is written, so the code survives: a coach checking their own code must
        # not spend the one they are about to hand over.
        raise HTTPException(status_code=409, detail=ALREADY_OWNED)
    player.coach_id = coach.id
    db.delete(transfer)
    db.commit()
    # The response is read off this row, and has_transfer_code was loaded before the
    # code was deleted, so it still says a code is live. The session does not expire on
    # commit, which is what leaves it to be dropped by hand.
    db.expire(player, ["has_transfer_code"])
    return player
