from datetime import UTC, datetime
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from matchpoint_api.auth import (
    SESSION_COOKIE,
    SESSION_LIFETIME,
    hash_token,
    new_session_token,
    set_session_cookie,
)
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.models import Coach, CoachSession
from matchpoint_api.rate_limit import RateLimiter, take_all
from matchpoint_api.schemas.auth import LoginRequest
from matchpoint_api.schemas.coach import CoachRead
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.security import DUMMY_HASH, hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db)]

# One message for an unknown email and a wrong password, on purpose: which of the two
# it was is exactly what a response must not disclose (the timing defence below is the
# other half of the same promise).
INCORRECT_CREDENTIALS = "Incorrect email or password"


def limit_login_rate(request: Request) -> None:
    """Refuse logins beyond a bounded arrival rate, before any password is verified.

    Sign-up's two tiers over again, keyed and sized the same way (`create_app` sizes
    both), and listed in the decorator's `dependencies` for the same reason: a refused
    request costs no body validation, no database session, and above all no Argon2 run.
    The address is a Cloudflare edge one an attacker can occupy many of, so it is the
    shared bucket that actually bounds what reaches Argon2.

    What guards an individual account is not here but in `reject_login`, because the
    question it answers — was this password wrong — is one only the handler can ask.
    """
    per_ip: RateLimiter = request.app.state.login_per_ip_limit
    total: RateLimiter = request.app.state.login_total_limit
    take_all((per_ip, request.client.host if request.client else ""), (total, "total"))


def reject_login(request: Request, email: str) -> NoReturn:
    """Refuse this attempt, charging it to the account's budget of wrong guesses.

    An unbounded login is a password-guessing oracle per *account*, not per address, and
    the tiers above cannot see accounts. This one is keyed on the submitted address —
    folded the way the row lookup folds it, or casing would mint fresh buckets — whether
    or not a row lives there, so an unknown email is charged exactly as a wrong password
    is and the 429 discloses nothing about which addresses hold accounts.

    Only a failed verification is charged, and a correct password never reaches here at
    all. That is what keeps a per-account bound from being an account-lockout lever:
    counting arrivals instead would let anyone who knows a coach's email — which
    sign-up's 409 hands out — spend each token as it refilled and keep that coach signed
    out for good. A guess is by definition wrong, so the tier gives up nothing by
    ignoring the requests that turn out right.

    The price is that a drained bucket no longer skips the Argon2 run, since the
    verification is what decides whether to charge it. What reaches Argon2 stays bounded
    by `limit_login_rate` either way, so this costs the account's attacker time, not the
    box's threads.
    """
    per_account: RateLimiter = request.app.state.login_per_account_limit
    per_account.take(email)  # the 429, once this account has spent its guesses
    raise HTTPException(status_code=401, detail=INCORRECT_CREDENTIALS)


# The 401 is declared because the login form has to branch on "wrong credentials",
# just as sign-up's 409 is — and declared with a model for ErrorDetail's reason.
@router.post(
    "/login",
    response_model=CoachRead,
    dependencies=[Depends(limit_login_rate)],
    responses={
        401: {"model": ErrorDetail, "description": INCORRECT_CREDENTIALS},
        429: {"model": ErrorDetail, "description": "Too many login attempts"},
    },
)
def login(data: LoginRequest, request: Request, db: DbSession, response: Response) -> Coach:
    # lower() folds the whole address because rows are stored lowercased and EmailStr
    # folds only the domain — a coach signing in as MIKE@ must find mike@'s row. The
    # per-account bucket keys on the same folding, so it must happen before reject_login.
    email = data.email.lower()
    coach = db.scalar(select(Coach).where(Coach.email == email))
    password = data.password.get_secret_value()
    if coach is None:
        # Burn the verification a real account would have cost. Skipping it would
        # answer "no such account" measurably faster than "wrong password", and the
        # difference is an oracle for which emails hold accounts. The result is
        # ignored: DUMMY_HASH matches nothing anyone can submit.
        verify_password(password, DUMMY_HASH)
        reject_login(request, email)
    if not verify_password(password, coach.password_hash):
        reject_login(request, email)
    # The one moment the plaintext and a database session are both in hand, so it is
    # here that a change to security.py's parameters reaches rows hashed before it.
    if needs_rehash(coach.password_hash):
        coach.password_hash = hash_password(password)
    now = datetime.now(UTC)
    # Signing in is the one moment this coach's own dead rows are cheap to find — the
    # foreign key's index already narrows to them — so the login that would add to the
    # pile clears it instead. It bounds only what a returning coach left behind: rows
    # belonging to a coach who never logs in again still have nothing to delete them,
    # and a session abandoned while still live waits out its full lifetime either way.
    db.execute(
        delete(CoachSession).where(
            CoachSession.coach_id == coach.id, CoachSession.expires_at <= now
        )
    )
    token = new_session_token()
    db.add(
        CoachSession(
            coach_id=coach.id,
            token_hash=hash_token(token),
            expires_at=now + SESSION_LIFETIME,
        )
    )
    db.commit()
    set_session_cookie(response, token)
    return coach


# 204 whether or not the cookie named a live session: logout is a request for a state
# ("signed out") rather than an action on a resource, and that state is reached either
# way. Failing on an already-dead session would only make double-clicks and retries
# into errors.
@router.post("/logout", status_code=204)
def logout(request: Request, db: DbSession, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token is not None:
        db.execute(delete(CoachSession).where(CoachSession.token_hash == hash_token(token)))
        db.commit()
    # Deleting the row is the revocation; clearing the cookie just stops the browser
    # presenting a corpse. The flags must match the ones the cookie was set with, or
    # the browser treats it as a different cookie and keeps the original.
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
