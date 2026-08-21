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
    RecoveryPlayer,
    hash_token,
    new_session_token,
    revoke_player_sessions,
    set_player_session_cookie,
)
from matchpoint_api.breach import BreachChecker
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.models import Player, PlayerSession
from matchpoint_api.password_policy import REJECTION, check_password
from matchpoint_api.rate_limit import RateLimiter, client_key, take_all
from matchpoint_api.routers.auth import INCORRECT_PASSWORD
from matchpoint_api.schemas.auth import PlayerChangePasswordRequest, PlayerLoginRequest
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


def credential_is_current(db: Session, player: Player, verified_hash: str) -> bool:
    """Lock the player's row, and say whether the hash just verified is still stored.

    Both routes below verify against an unlocked read and then write, so a regenerate
    committing in between would leave a session minted from the password it just revoked:
    that delete only reaches the rows existing at that instant (docs/security.md). Taking
    the lock `owned_player` takes orders the two instead. Called before the new hash is
    assigned, since autoflush would otherwise re-read this request's own pending write.
    """
    stored = db.scalar(select(Player.password_hash).where(Player.id == player.id).with_for_update())
    return stored == verified_hash


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
    verified_hash = player.password_hash
    if not verify_password(password, verified_hash):
        reject_player_login(request, username)
    # The one moment plaintext and a database session are both in hand, as at login:
    # a change to security.py's parameters reaches rows hashed before it. Hashed before
    # the lock below rather than after it, so the Argon2 semaphore is never waited on
    # holding a row.
    rehashed = hash_password(password) if needs_rehash(verified_hash) else None
    if not credential_is_current(db, player, verified_hash):
        # A regenerate landed while this login was verifying, so the password presented
        # is the revoked one and mints nothing. No wrong-guess token: the guess was right
        # when made, and the loser is usually the player their coach just re-credentialed.
        raise HTTPException(status_code=401, detail=INCORRECT_PLAYER_CREDENTIALS)
    if rehashed is not None:
        player.password_hash = rehashed
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


# Changing a player's own password: the coach route's design over again, current
# password required because the cookie proves a past sign-in, not that whoever holds
# it now knows the password. RecoveryPlayer for the coach route's reason: the route
# that ends a stolen session's access must not spend from the budget that session's
# own traffic drains.
@router.post(
    "/change-password",
    status_code=204,
    responses={
        400: {"model": ErrorDetail, "description": REJECTION},
        401: {"model": ErrorDetail, "description": "Not signed in"},
        403: {"model": ErrorDetail, "description": INCORRECT_PASSWORD},
        # This route's own tiers and the recovery budget both answer 429 here, so the
        # description is the wider one the body already carries.
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def change_player_password(
    data: PlayerChangePasswordRequest, player: RecoveryPlayer, request: Request, db: DbSession
) -> None:
    """Replace this player's password, given the current one, and end every session.

    The caller keeps working on a freshly issued session cookie. A wrong current
    password answers 403, a missing or dead session 401, and a new password the
    policy refuses 400, that one after the 403, so a caller getting both wrong hears
    about the current password first.
    """
    # In the handler, after the session resolves, for the coach route's reason: a
    # stranger must not be able to drain the shared bucket, and a 401 reaches no hash.
    per_ip: RateLimiter = request.app.state.player_change_password_per_ip_limit
    total: RateLimiter = request.app.state.player_change_password_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))
    # A NULL hash cannot happen here in practice (a session exists, so a login did,
    # so a password was minted), but a regenerate can race this request: the coach
    # route's plain read of the column becomes a None-guard rather than a crash.
    verified_hash = player.password_hash
    if verified_hash is None or not verify_password(
        data.password.get_secret_value(), verified_hash
    ):
        # A budget of wrong guesses charged only for one, keyed on the player:
        # the coach route's tier for its reasons.
        per_player: RateLimiter = request.app.state.player_change_password_per_player_limit
        per_player.take(str(player.id))
        raise HTTPException(status_code=403, detail=INCORRECT_PASSWORD)
    breach_checker: BreachChecker = request.app.state.breach_checker
    # The player's context words for the policy: no email to split, so the username
    # and the joined name carry what a guesser who knows the player would try first.
    check_password(
        data.new_password.get_secret_value(),
        email=None,
        names=[player.username, f"{player.first_name} {player.last_name}"],
        breach_checker=breach_checker,
    )
    # Hashed before the lock for the login route's reason. Without the lock a regenerate
    # that has already revoked every session would be overwritten here, handing the caller
    # a password of their own choosing on the row the coach believes they took back.
    new_hash = hash_password(data.new_password.get_secret_value())
    if not credential_is_current(db, player, verified_hash):
        # The regenerate won, so the current-password proof this request carries is
        # stale: it answers as a wrong password does, charging nothing for login's reason.
        raise HTTPException(status_code=403, detail=INCORRECT_PASSWORD)
    player.password_hash = new_hash
    # Every session dies, the presented one included, for the coach route's reason: a
    # thief holds a copy of the same token, so sparing it spares the thief.
    revoke_player_sessions(db, player.id)
    # A fresh session for the device that just proved the password.
    token = new_session_token()
    db.add(
        PlayerSession(
            player_id=player.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + SESSION_LIFETIME,
        )
    )
    db.commit()
    # Handed over via the renewal channel, so this write and current_player's own
    # renewal cannot both set the cookie: the handler runs after the dependency, so
    # the token the browser keeps is this one.
    request.state.renewed_player_session_token = token


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
