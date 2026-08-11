from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from matchpoint_api.auth import SESSION_COOKIE, SESSION_LIFETIME, hash_token, new_session_token
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.models import Coach, CoachSession
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


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )


# The 401 is declared because the login form has to branch on "wrong credentials",
# just as sign-up's 409 is — and declared with a model for ErrorDetail's reason.
@router.post(
    "/login",
    response_model=CoachRead,
    responses={401: {"model": ErrorDetail, "description": INCORRECT_CREDENTIALS}},
)
def login(data: LoginRequest, db: DbSession, response: Response) -> Coach:
    # lower() folds the whole address because rows are stored lowercased and EmailStr
    # folds only the domain — a coach signing in as MIKE@ must find mike@'s row.
    coach = db.scalar(select(Coach).where(Coach.email == data.email.lower()))
    password = data.password.get_secret_value()
    if coach is None:
        # Burn the verification a real account would have cost. Skipping it would
        # answer "no such account" measurably faster than "wrong password", and the
        # difference is an oracle for which emails hold accounts. The result is
        # ignored: DUMMY_HASH matches nothing anyone can submit.
        verify_password(password, DUMMY_HASH)
        raise HTTPException(status_code=401, detail=INCORRECT_CREDENTIALS)
    if not verify_password(password, coach.password_hash):
        raise HTTPException(status_code=401, detail=INCORRECT_CREDENTIALS)
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
    _set_session_cookie(response, token)
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
