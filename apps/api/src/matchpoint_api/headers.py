"""Security headers on every API response the app itself produces.

Caddy sets the static shell's headers, but a header set only at the proxy is absent
whenever the proxy is not in front (dev, tests), so API responses carry their own.
Middleware rather than per route for the 422 handler's reason: protection must not
depend on each route remembering it. The exception is the 500 from an unhandled
exception, which Starlette writes above every middleware. Policy: docs/security.md.
"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# An API serves JSON: nothing in a response should ever execute, render, or be framed.
STRICT_CSP = "default-src 'none'; frame-ancestors 'none'"

# /docs is the one HTML page the API serves (main.py turns the others off). FastAPI's
# Swagger page pulls its bundle and stylesheet from jsdelivr and boots it with an inline
# script, so this path alone gets those sources back; no JSON response is ever relaxed.
# Swagger UI also injects inline styles, and the favicon comes from fastapi.tiangolo.com.
DOCS_CSP = (
    "default-src 'none'; "
    "script-src 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src https://fastapi.tiangolo.com data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Stamps the security header set on whatever response the request produces."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        # Uvicorn prefixes its --root-path onto the path, so under the deployed
        # `--root-path /api` the docs page arrives here as /api/docs. Strip the prefix
        # back off, as Starlette's router does before it matches a route.
        route_path = request.url.path.removeprefix(request.scope.get("root_path", ""))
        docs = route_path == "/docs"
        response.headers["Content-Security-Policy"] = DOCS_CSP if docs else STRICT_CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response
