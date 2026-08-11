from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import Coach
from matchpoint_api.rate_limit import RateLimiter, take_all
from matchpoint_api.schemas.coach import CoachCreate, CoachRead
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.security import hash_password

router = APIRouter(prefix="/coaches", tags=["coaches"])

DbSession = Annotated[Session, Depends(get_db)]


def limit_sign_up_rate(request: Request) -> None:
    """Refuse sign-ups beyond a bounded arrival rate, before anything is spent on one.

    Listed in the decorator's `dependencies`, which run ahead of the handler's own — so a
    refused request costs no body validation, no database session, and above all no Argon2
    hash. Every arrival that parses counts, not just the valid ones: a body the schema
    rejects still spent a worker thread getting rejected. A body that is not JSON at all is
    not counted, since FastAPI parses before it solves any dependency and answers that with
    its own 422 — cheaper than the ones that are counted, and no Argon2 either way.

    Two tiers, counted together by `take_all` so that a refusal by either spends a token
    in neither. The per-address bucket is fairness over time rather than in the instant:
    its burst matches the shared one, so a group behind a single NAT is bounded by the
    tier sized for the hardware instead of a tighter one, but its refill is a third as
    fast, so a flooding address is the first of the two to run dry and cannot hold sign-up
    for longer than one shared burst. The shared bucket is the actual bound: behind
    Cloudflare the client address is an edge address, of which an attacker can occupy many,
    so only a key nobody escapes bounds what reaches Argon2. A flood therefore throttles
    sign-up itself — the tradeoff over the alternative, which was every route in the app
    stalling behind sign-up's parked threads.

    The buckets live on app state (sized where they are built, in `create_app`) rather
    than at module level, so every `create_app()` — each test's app included — counts
    from zero.
    """
    per_ip: RateLimiter = request.app.state.sign_up_per_ip_limit
    total: RateLimiter = request.app.state.sign_up_total_limit
    take_all((per_ip, request.client.host if request.client else ""), (total, "total"))


# Deliberately open: anyone can create an account. Right for usability testing with the
# client, but a choice rather than an oversight — as is the 409 below, which tells an
# unauthenticated caller whether an address has an account.
#
# The 409 is declared because the sign-up form has to branch on "email taken", which is
# not true of the 404s the other routers raise and leave undeclared. Declared with a
# model and not a bare description, for the reason ErrorDetail gives.
@router.post(
    "",
    status_code=201,
    response_model=CoachRead,
    dependencies=[Depends(limit_sign_up_rate)],
    responses={
        409: {"model": ErrorDetail, "description": "Email already registered"},
        429: {"model": ErrorDetail, "description": "Too many sign-up attempts"},
    },
)
def create_coach(data: CoachCreate, db: DbSession) -> Coach:
    # Fields named rather than the Model(**data.model_dump()) splat the other create
    # routes use: password is not password_hash, so there is no field-for-column mapping
    # for a splat to rely on. Hashing before db.add, so a rejected body costs no hash.
    coach = Coach(
        email=data.email,
        display_name=data.display_name,
        password_hash=hash_password(data.password.get_secret_value()),
    )
    db.add(coach)
    # Caught rather than pre-checked with a SELECT, which is where this departs from
    # create_match's existence check. Two simultaneous sign-ups on one address both pass
    # any pre-check and one still raises, so the catch would be needed regardless and the
    # pre-check would only add a round-trip. create_match has no such race: the player it
    # looks up is not one the same request is creating.
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Narrows the type for Pyright, and separates the two constraints that can raise
        # here: the unique email (23505) and coach_email_lowercase (23514, unreachable
        # through the ORM, which lowercases on the way in). coaches has exactly one unique
        # constraint, so no constraint-name match is needed; a second one would change that.
        if isinstance(exc.orig, UniqueViolation):
            raise HTTPException(status_code=409, detail="Email already registered") from exc
        raise
    return coach


# Deliberately no list route to pair with the ones on players and matches: a coach
# roster is a list of email addresses, and even a signed-in coach has no business with
# the others'. With a POST on this path the absence reads as a 405 rather than a 404 —
# the method is what is missing, not the route.
#
# This replaces the by-id route outright rather than joining it: fetching by id existed
# because nothing could identify a caller, so the coach's own unguessable UUID stood in
# as the credential. The session cookie is the credential now, and keeping the old
# route would have kept its UUID-as-secret semantics alongside. The 401 is declared
# with a model so the client can route it to a login screen, per ErrorDetail's note.
@router.get(
    "/me",
    response_model=CoachRead,
    responses={401: {"model": ErrorDetail, "description": "Not signed in"}},
)
def get_current_coach(coach: CurrentCoach) -> Coach:
    return coach
