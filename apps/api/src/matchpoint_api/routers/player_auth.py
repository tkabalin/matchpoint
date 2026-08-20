"""The player's own entry points: the second, lesser principal's half of auth.

Separate routes rather than a disambiguating /auth/login, decided on the issue: the
two logins answer with different shapes (a trimmed self-view against CoachRead), set
different cookies, and spend different rate buckets, so one endpoint would be two
contracts under one name. The web app still presents a single sign-in form and picks
the endpoint by credential shape, an email against a bare username.
"""

from datetime import UTC, datetime
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from matchpoint_api.auth import (
    PLAYER_SESSION_COOKIE,
    SESSION_LIFETIME,
    CurrentPlayer,
    hash_token,
    new_session_token,
    set_player_session_cookie,
)
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.models import Player, PlayerSession
from matchpoint_api.rate_limit import RateLimiter, client_key, take_all
from matchpoint_api.schemas.auth import PlayerLoginRequest
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.schemas.player import PlayerSelfRead
from matchpoint_api.security import DUMMY_HASH, hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/auth/player", tags=["player-auth"])

DbSession = Annotated[Session, Depends(get_db)]

# One message for an unknown username, a wrong password, and a player whose coach has
# not minted a password yet: which of the three it was is exactly what a response must
# not disclose, and the third would otherwise read as "this username exists".
INCORRECT_PLAYER_CREDENTIALS = "Incorrect username or password"


def limit_player_login_rate(request: Request) -> None:
    """limit_login_rate for the player entry point, in buckets of its own.

    The same two tiers for the same reasons, listed in the decorator's `dependencies`
    so a refusal costs no body validation and no Argon2. Separate buckets so a login
    flood aimed at players cannot price coaches out of signing in, or the reverse.
    """
    per_ip: RateLimiter = request.app.state.player_login_per_ip_limit
    total: RateLimiter = request.app.state.player_login_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))


def reject_player_login(request: Request, username: str) -> NoReturn:
    """reject_login for the player principal: the same wrong-guess budget, same terms.

    Keyed on the submitted username folded as rows store it, charged only after a
    failed verification so it can never become a lockout lever, and charged for an
    unknown username exactly as for a wrong password. The full argument is
    reject_login's, unchanged; usernames being derivable from names only raises the
    stakes, since guessing who has an account here takes no leak at all.
    """
    per_account: RateLimiter = request.app.state.player_login_per_account_limit
    per_account.take(username)
    raise HTTPException(status_code=401, detail=INCORRECT_PLAYER_CREDENTIALS)


# The 401 is declared because the sign-in form branches on "wrong credentials", with a
# model for ErrorDetail's reason.
@router.post(
    "/login",
    response_model=PlayerSelfRead,
    dependencies=[Depends(limit_player_login_rate)],
    responses={
        401: {"model": ErrorDetail, "description": INCORRECT_PLAYER_CREDENTIALS},
        429: {"model": ErrorDetail, "description": "Too many login attempts"},
    },
)
def player_login(
    data: PlayerLoginRequest, request: Request, db: DbSession, response: Response
) -> Player:
    # Usernames are stored lowercase (usernames.py), so folding here is what lets
    # KBLTHO001 read off paper find kbltho001's row. The per-account bucket keys on
    # the same folding, so it must happen before reject_player_login can charge it.
    username = data.username.lower()
    player = db.scalar(select(Player).where(Player.username == username))
    password = data.password.get_secret_value()
    if player is None or player.password_hash is None:
        # Burn the verification a live credential would have cost: login's timing
        # defence, with a third indistinguishable case folded in. A player whose
        # coach has not minted a password yet must answer exactly like a wrong one,
        # or the timing would say which usernames are live accounts.
        verify_password(password, DUMMY_HASH)
        reject_player_login(request, username)
    if not verify_password(password, player.password_hash):
        reject_player_login(request, username)
    # The one moment plaintext and a database session are both in hand, as at login:
    # a change to security.py's parameters reaches rows hashed before it.
    if needs_rehash(player.password_hash):
        player.password_hash = hash_password(password)
    now = datetime.now(UTC)
    # The signing-in player's own dead rows go now: login's sweep, login's reasoning.
    db.execute(
        delete(PlayerSession).where(
            PlayerSession.player_id == player.id, PlayerSession.expires_at <= now
        )
    )
    token = new_session_token()
    db.add(
        PlayerSession(
            player_id=player.id,
            token_hash=hash_token(token),
            expires_at=now + SESSION_LIFETIME,
        )
    )
    db.commit()
    set_player_session_cookie(response, token)
    return player


# /auth/player/me rather than /players/me: the players router is coach-scoped end to
# end (its router-level 401 and docs assume a coach session), and /players/me would
# also sit in /players/{player_id}'s path space, matched only by declaration order.
# The 401 and 429 are declared per route because current_player reads the cookie off
# the request, so nothing else would put them in the spec.
@router.get(
    "/me",
    response_model=PlayerSelfRead,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def get_current_player(player: CurrentPlayer) -> Player:
    """The signed-in player's own profile."""
    return player


# 204 whether or not the cookie named a live session, for logout's reason: the request
# asks for a state ("signed out"), and that state is reached either way.
@router.post("/logout", status_code=204)
def player_logout(request: Request, db: DbSession, response: Response) -> None:
    token = request.cookies.get(PLAYER_SESSION_COOKIE)
    if token is not None:
        db.execute(delete(PlayerSession).where(PlayerSession.token_hash == hash_token(token)))
        db.commit()
    # Deleting the row is the revocation; clearing the cookie stops the browser
    # presenting a corpse, and the flags must match the ones it was set with.
    response.delete_cookie(
        PLAYER_SESSION_COOKIE,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
