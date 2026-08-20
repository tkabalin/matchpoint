from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from psycopg.errors import UniqueViolation
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api import photos
from matchpoint_api.auth import (
    SESSION_COOKIE,
    VERIFICATION_COOKIE,
    CurrentCoach,
    credential_is_current,
    hash_token,
    revoke_sessions,
)
from matchpoint_api.breach import BreachChecker
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.models import (
    Coach,
    DeletedMatch,
    EmailVerification,
    Match,
    PasswordReset,
    Player,
    PlayerSession,
    PlayerTransferCode,
    Point,
)
from matchpoint_api.password_policy import REJECTION, check_password
from matchpoint_api.rate_limit import RateLimiter, client_key, take_all
from matchpoint_api.routers.auth import INCORRECT_PASSWORD
from matchpoint_api.routers.players import TRANSFER_CODES_OUTSTANDING
from matchpoint_api.schemas.coach import (
    CoachCreate,
    CoachDelete,
    CoachRead,
    CoachUpdate,
    CoachVerifyPassword,
)
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.security import hash_password, verify_password

router = APIRouter(prefix="/coaches", tags=["coaches"])

DbSession = Annotated[Session, Depends(get_db)]

# Names the two ways out and no more. Which players are in the way is not in the body:
# `ErrorDetail` carries one string, and the form holds the roster already, so it can name
# them where a count folded into this message could not.
PLAYERS_REMAIN = "Players must be transferred or deleted first"


def limit_sign_up_rate(request: Request) -> None:
    """Refuse sign-ups beyond a bounded arrival rate, before anything is spent on one.

    Listed in the decorator's `dependencies`, which run first, so a refused request costs no
    body validation, no database session and above all no Argon2 hash. Every arrival that
    parses counts, valid or not — a body the schema rejects still spent a worker thread.

    Two tiers, counted together by `take_all` so a refusal by either spends a token in
    neither. The shared bucket is the actual bound: behind Cloudflare the client address is
    an edge address an attacker can occupy many of, so only a key nobody escapes bounds what
    reaches Argon2. The per-address tier is fairness — same burst, a third of the refill, so
    a flooding address runs dry first. The tradeoff is that a flood throttles sign-up itself
    rather than every route in the app stalling behind its parked threads.

    The buckets live on app state (sized in `create_app`), so each test's app counts from zero.
    """
    per_ip: RateLimiter = request.app.state.sign_up_per_ip_limit
    total: RateLimiter = request.app.state.sign_up_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))


def _email_not_verified() -> HTTPException:
    # One message for a missing cookie, an unknown token, a mismatched email, an expired
    # verification and one already spent: to the caller they are the same fact, and
    # distinguishing them would only describe the server's bookkeeping to whoever is probing.
    #
    # "Already spent" is the arguable one — a sign-up whose 201 was lost retries into it and
    # is told to verify an address that now has an account. The 409 is not available there:
    # it would tell a caller holding no live verification whether an address is registered.
    # Recovery costs a step instead, since requesting a fresh code 409s.
    return HTTPException(status_code=401, detail="Email not verified")


# Creating an account demands the verification cookie verify-otp minted (#44), so the only
# emails that reach a coach row are ones a code was just delivered to. That also takes the
# 409 out of enumeration range: without a cookie for the address the answer is the 401, so
# enumeration is request-otp's question now, metered by its per-email limit. It stays
# declared — with a model, for the reason ErrorDetail gives — because the sign-up form has
# to branch on "email taken", which is not true of the 404s the other routers leave
# undeclared.
@router.post(
    "",
    status_code=201,
    response_model=CoachRead,
    dependencies=[Depends(limit_sign_up_rate)],
    responses={
        400: {"model": ErrorDetail, "description": REJECTION},
        401: {"model": ErrorDetail, "description": "Email not verified"},
        409: {"model": ErrorDetail, "description": "Email already registered"},
        429: {"model": ErrorDetail, "description": "Too many sign-up attempts"},
    },
)
def create_coach(data: CoachCreate, db: DbSession, request: Request) -> Coach:
    # From request.cookies rather than a Cookie() parameter, for current_coach's reason: a
    # declared cookie parameter reaches the spec and the generated client's signature. Checked
    # here rather than in a dependency because the match below needs the validated body and the
    # consume must share the insert's transaction — so a bad body 422s before a missing cookie
    # 401s.
    token = request.cookies.get(VERIFICATION_COOKIE)
    if token is None:
        raise _email_not_verified()
    breach_checker: BreachChecker = request.app.state.breach_checker
    # Ahead of the consume below, not folded into it: a refused password leaves the
    # verification standing, so the coach picks another and carries on, where a check
    # after it would cost them a fresh code for a typo. Ahead of the Argon2 hash too,
    # for rate limiting's reason. Only the missing-cookie 401 precedes it, so a cookie the
    # consume would reject hears the policy reason first; the policy is published, so that
    # answers nothing `docs/security.md` does not.
    #
    # What that ordering now also costs: a made-up cookie value reaches the breach lookup
    # before the consume rejects it, so it spends a worker thread and a request the corpus
    # did not need to answer. Kept, because validating the row first would either duplicate
    # the consume's WHERE or give up the property above, and limit_sign_up_rate bounds it.
    check_password(
        data.password.get_secret_value(),
        email=data.email,
        names=[data.display_name],
        breach_checker=breach_checker,
    )
    # One statement is the validity check, the email match and the consumption, so single-use
    # needs no lock and expiry has no read-then-act window. The email is in the WHERE because
    # a cookie proving mike@ must not authorise an account for sam@ — lowercased to match what
    # verify-otp wrote, since EmailStr only folds the domain. The 409 path rolls it back, which
    # is right: the coach already exists, so the cookie had nothing to authorise.
    #
    # Consumed before the Argon2 work below, so an unverified request costs no hash — paid for
    # by holding a connection and this row's lock across a hash security.py gates at two at a
    # time, so a sign-up burst parks connections `idle in transaction`. Bounded (burst 10,
    # engine default pool 15), but that pool is shared with login, so whichever burst grows
    # takes the pool size with it.
    consumed = db.execute(
        delete(EmailVerification)
        .where(
            EmailVerification.token_hash == hash_token(token),
            EmailVerification.email == data.email.lower(),
            EmailVerification.expires_at > datetime.now(UTC),
        )
        .returning(EmailVerification.id)
    ).one_or_none()
    if consumed is None:
        raise _email_not_verified()
    # Fields named rather than the Model(**data.model_dump()) splat the other create routes
    # use: password is not password_hash, so there is no field-for-column mapping to rely on.
    coach = Coach(
        email=data.email,
        display_name=data.display_name,
        password_hash=hash_password(data.password.get_secret_value()),
    )
    db.add(coach)
    # Caught rather than pre-checked with a SELECT, unlike create_match's existence check:
    # two simultaneous sign-ups on one address both pass any pre-check and one still raises,
    # so the catch is needed regardless and the pre-check only adds a round-trip. create_match
    # has no such race — the player it looks up is not one the same request is creating.
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Narrows the type for Pyright, and separates the unique email (23505) from
        # coach_email_lowercase (23514, unreachable through the ORM, which lowercases on the
        # way in). coaches has exactly one unique constraint, so no constraint-name match is
        # needed; a second one would change that.
        if isinstance(exc.orig, UniqueViolation):
            raise HTTPException(status_code=409, detail="Email already registered") from exc
        raise
    return coach


# Deliberately no list route to pair with the ones on players and matches: a coach roster is
# a list of email addresses, and even a signed-in coach has no business with the others'.
#
# This replaces the by-id route outright rather than joining it: fetching by id existed
# because nothing could identify a caller, so the coach's own unguessable UUID stood in as
# the credential. The session cookie is the credential now, and keeping the old route would
# have kept its UUID-as-secret semantics alongside.
@router.get(
    "/me",
    response_model=CoachRead,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def get_current_coach(coach: CurrentCoach) -> Coach:
    return coach


# The signed-in coach is the only coach this can address, so there is no id in the path
# and no ownership check to get wrong.
@router.patch(
    "/me",
    response_model=CoachRead,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def update_current_coach(data: CoachUpdate, db: DbSession, coach: CurrentCoach) -> Coach:
    # updated_at moves on its own, from the column's onupdate.
    data.apply_to(coach)
    db.commit()
    return coach


# A photo is set and cleared by its own endpoints rather than through PATCH /me, because
# a client cannot name a URL it does not own: what it sends is bytes, and what it gets
# back is where they ended up. Both answer with the whole coach, since a new photo means
# a new key and so a URL the caller has no other way to learn.


def _locked_coach(db: Session, coach: Coach) -> Coach:
    """Re-select this coach FOR UPDATE, closing the race `owned_player`'s lock closes.

    `current_coach` loads the row without a lock, so two requests racing on the same
    coach's photo could each read the same starting `photo_key`, each store a file, and
    each commit — orphaning the loser's file.
    """
    locked = db.get(Coach, coach.id, with_for_update=True)
    if locked is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return locked


@router.post(
    "/me/photo",
    response_model=CoachRead,
    responses={
        400: {"model": ErrorDetail, "description": photos.PHOTO_REFUSED},
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def upload_coach_photo(
    file: Annotated[UploadFile, File()], coach: CurrentCoach, db: DbSession, request: Request
) -> Coach:
    """Replace this coach's profile photo, and answer with the coach."""
    photos.limit_photo_upload_rate(request, coach.id)
    # Ends whatever transaction current_coach's session began, so a connection isn't
    # pinned across the semaphore wait inside store_photo below — the row lock is taken
    # only around the write, which is the part that actually needs it.
    db.rollback()
    new_key = photos.store_photo(file)
    coach = _locked_coach(db, coach)
    photos.replace_key(db, coach, new_key)
    return coach


@router.delete(
    "/me/photo",
    response_model=CoachRead,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def delete_coach_photo(coach: CurrentCoach, db: DbSession) -> Coach:
    """Clear this coach's profile photo, back to the app's initials avatar."""
    coach = _locked_coach(db, coach)
    # Clearing a photo that is not there is a no-op rather than a 404, for the reason
    # archiving twice is: a retried request must neither error nor move the row.
    if coach.photo_key is not None:
        photos.replace_key(db, coach, None)
    return coach


# The closure's password step, asked one screen ahead of the confirmation so a coach who
# mistypes hears about it where they typed it rather than at the warning (#207). It proves
# nothing for later: the closure re-verifies, and this route writes nothing, so a 204 here
# is an answer about a password and never an authorisation to spend at the next request.
@router.post(
    "/me/verify-password",
    status_code=204,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        403: {"model": ErrorDetail, "description": INCORRECT_PASSWORD},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def verify_coach_password(data: CoachVerifyPassword, coach: CurrentCoach, request: Request) -> None:
    """Answer whether this is the signed-in coach's password, changing nothing."""
    # The closure's own tiers rather than a set of this route's, because the two are one
    # flow's two steps: a budget apiece would hand a stolen session five wrong guesses
    # per screen where the point of the budget is to bound the hunt at five in total.
    #
    # In the handler and not the decorator's dependencies, as the closure takes them:
    # metering after the session resolves stops a stranger who can reach no hash at all
    # from draining the shared bucket.
    per_ip: RateLimiter = request.app.state.close_account_per_ip_limit
    total: RateLimiter = request.app.state.close_account_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))
    if not verify_password(data.password.get_secret_value(), coach.password_hash):
        # Charged only for a wrong guess, so the coach who knows their own password is
        # never refused by this tier however hard someone else is guessing.
        per_coach: RateLimiter = request.app.state.close_account_per_coach_limit
        per_coach.take(str(coach.id))
        raise HTTPException(status_code=403, detail=INCORRECT_PASSWORD)


# Closing an account erases the coach and everything below them (#146), rather than
# leaving the email, the name and the password hash on a row nobody can reach, which is
# not what a coach asking to be removed has asked for. What the cascade takes with it is
# in `docs/data-model.md`.
#
# The password is demanded for change-password's reason, with more at stake: the cookie
# proves this browser was signed in once, not that whoever holds it now is the coach, and
# there is nothing to recover to afterwards.
#
# Both the 403 and the 409 are declared because the form branches on each, the first
# inline on the password field and the second on the roster. The 403's message is
# change-password's, so a refused re-authentication reads the same wherever a coach meets
# one. Two different roster states answer the 409, so its description names both.
@router.delete(
    "/me",
    status_code=204,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        403: {"model": ErrorDetail, "description": INCORRECT_PASSWORD},
        409: {
            "model": ErrorDetail,
            "description": f"{PLAYERS_REMAIN}, or {TRANSFER_CODES_OUTSTANDING}",
        },
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def delete_current_coach(
    data: CoachDelete,
    coach: CurrentCoach,
    request: Request,
    db: DbSession,
    response: Response,
) -> None:
    """Erase this coach and everything recorded under them, given their password.

    Refused with a 409 while any player is still on the roster, so that someone another
    coach is about to take over is not erased by an account closing: clear each one
    first, by transfer or by deletion. `delete_players` waives that refusal and takes
    the whole roster along, for the coach who means to leave nothing behind, but not a
    live transfer code on any player, which refuses closure either way.
    """
    # In the handler rather than the decorator's dependencies, as change-password takes
    # its tiers: metering after the session resolves stops a stranger who can reach no
    # hash at all from draining the shared bucket.
    per_ip: RateLimiter = request.app.state.close_account_per_ip_limit
    total: RateLimiter = request.app.state.close_account_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))
    verified_hash = coach.password_hash
    if not verify_password(data.password.get_secret_value(), verified_hash):
        # change-password's wrong-guess budget, charged only for a failure: what it bounds
        # is a stolen session hunting for the password, and here that hunt ends in a delete
        # nothing undoes.
        per_coach: RateLimiter = request.app.state.close_account_per_coach_limit
        per_coach.take(str(coach.id))
        raise HTTPException(status_code=403, detail=INCORRECT_PASSWORD)
    # Locked here rather than at `_locked_coach` below, so nothing can retire the password
    # between the proof and the erase: a coach changing their password to end a thief's
    # access must not have the account deleted by a request that proof was made for.
    if not credential_is_current(db, coach, verified_hash):
        raise HTTPException(status_code=403, detail=INCORRECT_PASSWORD)
    # After the password and not before it: every answer this route gives past the 401
    # comes from a caller who has just re-authenticated, so no later answer has to argue
    # afresh about what it tells a stolen cookie.
    if not data.delete_players:
        remaining = select(Player.id).where(Player.coach_id == coach.id)
        if db.scalar(select(remaining.exists())):
            raise HTTPException(status_code=409, detail=PLAYERS_REMAIN)
    # Unconditional, unlike the check above: a live code is another coach's pending
    # claim on the player, not this coach's data to discard by asking to leave nothing
    # behind. DELETE /players/{id} refuses over one for the same reason, so the roster
    # cannot be cleared past this check a player at a time either.
    outstanding_codes = (
        select(PlayerTransferCode.id)
        .join(Player, PlayerTransferCode.player_id == Player.id)
        .where(Player.coach_id == coach.id)
    )
    if db.scalar(select(outstanding_codes.exists())):
        raise HTTPException(status_code=409, detail=TRANSFER_CODES_OUTSTANDING)
    # Collected before the deletes below, which are what removes the rows holding them.
    # Postgres cannot help here the way its foreign keys do for a table left out of the
    # list: a photo file has nothing pointing at it, so one missed is simply never
    # reclaimed rather than a delete that fails loudly.
    #
    # FOR UPDATE on every one of the coach's players, not only those with a photo
    # already set: a concurrent upload takes the same lock (owned_player's for_update)
    # before it stores a file, so locking only the rows that already have a key would
    # let an upload to a still-bare player slip in between this select and the delete
    # below, and its file would never be queued for cleanup.
    coach = _locked_coach(db, coach)
    player_photo_keys = db.scalars(
        select(Player.photo_key).where(Player.coach_id == coach.id).with_for_update()
    )
    photo_keys = [coach.photo_key, *(key for key in player_photo_keys if key is not None)]
    # Children first, in one transaction, because no foreign key here declares an
    # `ondelete` bar the derived set rows, which follow their match out on their own, so a
    # table added below the coach and left out of this list stops the delete outright
    # rather than being quietly missed. Nothing keys on the email (`email_verifications`
    # cannot hold a registered address), so the address is free for a fresh sign-up the
    # moment this commits.
    their_players = select(Player.id).where(Player.coach_id == coach.id)
    their_matches = select(Match.id).where(Match.player_id.in_(their_players))
    db.execute(delete(Point).where(Point.match_id.in_(their_matches)))
    db.execute(delete(Match).where(Match.player_id.in_(their_players)))
    # The roster's own logins go too, before the players they authenticate: closing
    # the account ends what every player under it could still reach, not only what
    # the coach could.
    db.execute(delete(PlayerSession).where(PlayerSession.player_id.in_(their_players)))
    db.execute(delete(Player).where(Player.coach_id == coach.id))
    db.execute(delete(PasswordReset).where(PasswordReset.coach_id == coach.id))
    db.execute(delete(DeletedMatch).where(DeletedMatch.coach_id == coach.id))
    revoke_sessions(db, coach.id)
    db.delete(coach)
    db.commit()
    # After the commit, as everywhere else a row and a file change together: the rows are
    # gone whichever way this goes, and a file left behind costs disk, not correctness.
    for key in photo_keys:
        photos.delete(key)
    # The rows are gone, so clearing the cookie only stops the browser presenting a
    # corpse, and the flags repeat the ones it was set with for logout's reason. The
    # renewal channel is emptied in the same breath: `current_coach` may have left a token
    # there, and the middleware writes after this response is built, so it would re-set
    # the very cookie deleted here.
    request.state.renewed_session_token = None
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
