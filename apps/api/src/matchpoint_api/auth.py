"""How a request proves who it is: an opaque session token in an HttpOnly cookie.

The token is 256 random bits, minted at login and held by the browser; the server
keeps only its SHA-256, in a `coach_sessions` row. Presenting the token is the proof,
so deleting the row is a complete revocation — which is the property that decided the
mechanism. Capture has to survive a whole match with no connection, so the credential
must be long-lived and must not expire silently courtside, and a long life is only
defensible when the server can end it early. A JWT (FastAPI's documented path) is
stateless right up until revocation is needed, at which point the denylist *is* this
table again — and the SPA would have to hold the token somewhere XSS can reach.
`docs/tech-stack.md` records the comparison.

HttpOnly keeps the token invisible to script, and Caddy serves the SPA and the API
from a single origin, so SameSite=Lax costs nothing and no cross-origin cookie design
(CORS, SameSite=None) ever arises.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.models import Coach, CoachSession

# The `__Host-` prefix binds the cookie to one host: a browser refuses it unless it is
# Secure, Path=/ and carries no Domain, and thereafter no other host can set or shadow
# it. The site is a subdomain of an apex it shares, and without the prefix a sibling
# subdomain could set a Domain-scoped cookie of this name that the browser would send
# alongside ours — a fixation the other flags do not close. Conditional because the
# prefix demands Secure, and plain-http local dev deliberately has no Secure cookie to
# put it on (see `settings.session_cookie_secure`).
SESSION_COOKIE = (
    "__Host-matchpoint_session" if settings.session_cookie_secure else "matchpoint_session"
)

# Long-lived for the offline-first reason above; renewal on use (the resolving
# dependency's job) means an active coach never actually reaches it, so this figure
# only decides when an *abandoned* login dies.
SESSION_LIFETIME = timedelta(days=30)


def new_session_token() -> str:
    """A fresh session token from the CSPRNG: 256 bits, URL-safe text.

    This is the value the cookie carries. It goes to the browser and is deliberately
    never stored — only its hash is.
    """
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """The stored form of a token: SHA-256 hex, exactly the width of the column.

    A plain digest rather than Argon2, on purpose. Password hashing is expensive
    because passwords are guessable; a 256-bit random token is not, so the digest's
    only job is to make a stolen copy of the table useless — and it runs on every
    authenticated request, where an Argon2 would be a self-inflicted slowdown.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def set_session_cookie(response: Response, token: str) -> None:
    """Hand the token to the browser, with the flags the module docstring argues for.

    Sent at login and again whenever the row below is renewed: Max-Age is absolute from
    the moment the cookie is sent, so moving only the row would leave the browser
    dropping a live session at the deadline the first cookie carried.
    """
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )


class SessionRenewalMiddleware(BaseHTTPMiddleware):
    """Sends a renewed session cookie on whatever response the request produces.

    A renewal is a fact about the session, not about how the endpoint went, so the
    cookie cannot ride on the `Response` a route returns: an `HTTPException`, or a body
    that fails validation, is answered by a fresh response built in an exception handler
    and a header written to the route's own is dropped. That loss is silent and lasting
    — the row's deadline has already moved, and renewal fires again only from the *new*
    halfway mark, so the browser would expire its copy on the old deadline with nothing
    re-sending it in between. Here the header is written where every response passes.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        # `request.state` is backed by the ASGI scope, which the endpoint and this
        # share, so the dependency below can leave the token here for us.
        token = getattr(request.state, "renewed_session_token", None)
        if token is not None:
            set_session_cookie(response, token)
        return response


def _unauthenticated() -> HTTPException:
    # One message for a missing cookie, an unknown token and an expired session: to
    # the caller they are the same fact ("sign in"), and distinguishing them would
    # only describe the server's bookkeeping to whoever is probing it.
    return HTTPException(status_code=401, detail="Not authenticated")


def current_coach(request: Request, db: Annotated[Session, Depends(get_db)]) -> Coach:
    """The coach whose session cookie authenticates this request, or a 401.

    Read from `request.cookies` rather than a `Cookie()` parameter, because a declared
    cookie parameter reaches the OpenAPI spec and so the generated client's function
    signatures — as an argument the browser, not the caller, is the one attaching.
    The cost is that routes must declare their 401 in `responses` themselves.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if token is None:
        raise _unauthenticated()
    token_hash = hash_token(token)
    # One query for the session and its coach. The join can never drop a live
    # session: coach_id is NOT NULL and the foreign key guarantees the coach row.
    row = db.execute(
        select(CoachSession, Coach)
        .join(Coach, CoachSession.coach_id == Coach.id)
        .where(CoachSession.token_hash == token_hash)
    ).first()
    if row is None:
        raise _unauthenticated()
    session, coach = row
    now = datetime.now(UTC)
    if session.expires_at <= now:
        # Presented and dead is the one moment an expired row is in hand, so it is
        # deleted here. By token_hash rather than through the row just loaded: a client
        # retrying a queued request can present one dead cookie twice at once, and the
        # second ORM delete would find its row already gone and warn about the rowcount.
        # This only ever catches a login someone came back for; the rows nobody presents
        # again are deliberately left to accumulate — no sweep runs.
        db.execute(delete(CoachSession).where(CoachSession.token_hash == token_hash))
        db.commit()
        raise _unauthenticated()
    if session.expires_at - now < SESSION_LIFETIME / 2:
        # Renewal on use, from the halfway mark: a coach who opens the app at all
        # keeps their login alive, so only abandoned sessions ever reach expiry —
        # that is what makes the long lifetime above safe to rely on courtside.
        # From halfway rather than on every request so that reads don't pay a write.
        session.expires_at = now + SESSION_LIFETIME
        db.commit()
        # The browser needs the new deadline too, or its copy of the cookie would still
        # expire on the original one and sign an active coach out. Left for the
        # middleware to send, for the reason its docstring gives.
        request.state.renewed_session_token = token
    return coach


CurrentCoach = Annotated[Coach, Depends(current_coach)]
