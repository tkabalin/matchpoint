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
from datetime import timedelta

from matchpoint_api.config import settings

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
