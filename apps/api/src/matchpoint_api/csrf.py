"""Refusing a state-changing request that did not come from this app's own origin.

`SameSite=Lax` on the session cookie stops the ordinary cross-site forgery, but counts
every host under the shared registrable domain as same-site, so a request from a sibling
of the apex we serve from arrives with the cookie attached. The origin a request must
name is the host it arrived at rather than a configured value, because a browser sends
the host it connected to and a cross-site caller cannot make the two agree.
`docs/security.md` records what each layer covers and why no token is added on top.
"""

from urllib.parse import urlsplit

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

# The methods that change nothing, so an origin says nothing worth acting on. GET and
# HEAD are the cookie-carrying navigations Lax deliberately allows; OPTIONS is here for
# completeness, since one origin means no CORS preflight ever arrives.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

FOREIGN_ORIGIN = "Request origin is not allowed"


def _is_own_origin(request: Request) -> bool:
    """Whether the request named this very host as the page it came from.

    Absent counts as foreign: on a write only a non-browser client omits the header, and
    the SPA is the only client this API has, so tolerating the absence would make the
    check optional exactly where an attacker gets to choose.
    """
    origin = request.headers.get("origin")
    if origin is None:
        return False
    # Host and port, not scheme: the scheme here is whatever `X-Forwarded-Proto` reported
    # through the proxy chain, and a change that stopped reporting it would refuse every
    # write in production to rule out an origin no attacker can hold anyway.
    try:
        return urlsplit(origin).netloc.lower() == request.url.netloc.lower()
    except ValueError:
        # Both sides are parsed, so either can raise: an unclosed IPv6 bracket in `Origin`
        # or in `Host` counts as foreign, since a garbage header must answer 403, not 500.
        return False


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """Refuses any unsafe method whose `Origin` is not this request's own host.

    Middleware rather than a per-route dependency, for `SessionRenewalMiddleware`'s
    reason: a rule a route can forget to declare is a rule a route will eventually forget
    to declare.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in SAFE_METHODS and not _is_own_origin(request):
            # Shaped like `ErrorDetail` so a client can read it, but declared on no route:
            # only a caller that is not this app can provoke it, so a generated client
            # branching on it would be branching on its own bug.
            return JSONResponse({"detail": FOREIGN_ORIGIN}, status_code=403)
        return await call_next(request)
