"""A ceiling on request body size, because Starlette ships none.

Without one, any caller who can reach the API can stream an arbitrarily large body
and the app will buffer all of it in memory. `infra/prod/Caddyfile` refuses oversized
bodies on the public path before they reach the app. This middleware is the same bound
on the paths Caddy does not front (local dev, and the container reachable directly on
the Docker network in production), and the only one of the two a test can exercise.
Keep the two figures identical.
"""

from fastapi import HTTPException
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Sized from the largest legitimate body this API will ever take: a batch of points
# from a full three-set match, ~400 points at ~250 bytes of JSON each, so ~100 KB.
# This is ten times that. Same figure as the Caddyfile's `max_size`.
MAX_REQUEST_BODY_BYTES = 1_000_000

DETAIL = "Request body too large"


class _BodyTooLarge(HTTPException):
    """Raised from the wrapped receive, usually mid-read inside a route.

    An HTTPException rather than a plain exception, because FastAPI's body reader
    swallows anything else raised while it reads and answers 400 "error parsing the
    body"; an HTTPException it re-raises, and its own handler answers the 413. The
    middleware's catch below is only for a read outside that handler's reach.
    """

    def __init__(self) -> None:
        super().__init__(status_code=413, detail=DETAIL)


class RequestBodyLimitMiddleware:
    """Answers 413 to any request body over MAX_REQUEST_BODY_BYTES.

    A Content-Length over the limit is refused before any of the body is read. A body
    streamed without one is counted as it arrives and refused at the first chunk past
    the limit, so omitting or understating the header buys a caller nothing.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        try:
            declared = int(Headers(scope=scope).get("content-length", ""))
        except ValueError:
            # Absent, or a value the server's own parser would have rejected. Left to
            # the count below, which bounds the body anyway: a ValueError escaping a
            # middleware is a 500, not a refusal.
            declared = 0
        if declared > MAX_REQUEST_BODY_BYTES:
            await _too_large(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BODY_BYTES:
                    raise _BodyTooLarge
            return message

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            # A route that streamed response headers before finishing with the body
            # cannot be answered 413 any more; re-raise rather than start a second
            # response, which is an ASGI protocol violation.
            if response_started:
                raise
            await _too_large(scope, receive, send)


async def _too_large(scope: Scope, receive: Receive, send: Send) -> None:
    # The `{"detail": ...}` shape every HTTPException answers with, but undeclared in
    # the spec: on the public path the 413 is Caddy's, so a declared model would lie
    # to the generated client.
    response = JSONResponse(status_code=413, content={"detail": DETAIL})
    await response(scope, receive, send)
