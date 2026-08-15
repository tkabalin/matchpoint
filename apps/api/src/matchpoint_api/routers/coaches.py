from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.errors import UniqueViolation
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.auth import VERIFICATION_COOKIE, CurrentCoach, hash_token
from matchpoint_api.db import get_db
from matchpoint_api.models import Coach, EmailVerification
from matchpoint_api.rate_limit import RateLimiter, client_key, take_all
from matchpoint_api.schemas.coach import CoachCreate, CoachRead, CoachUpdate
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.security import hash_password

router = APIRouter(prefix="/coaches", tags=["coaches"])

DbSession = Annotated[Session, Depends(get_db)]


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
