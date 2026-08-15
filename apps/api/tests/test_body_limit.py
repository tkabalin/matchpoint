"""The request-body ceiling: both refusal paths, and the boundary itself.

The integration tests take the two ways a body gets refused, a declared Content-Length
and a chunked stream that never declares one, and prove a body of exactly the limit
still reaches routing. The unit tests pin the edges routing cannot
reach: a response already started, a receive message with no body, and a Content-Length
the server's own parser would have rejected.
"""

from collections.abc import Iterator

import anyio
import pytest
from fastapi.testclient import TestClient
from starlette.types import Message, Receive, Scope, Send

from matchpoint_api.body_limit import (
    MAX_REQUEST_BODY_BYTES,
    RequestBodyLimitMiddleware,
    _BodyTooLarge,
)

JSON = {"Content-Type": "application/json"}


def test_oversized_declared_body_is_refused(client: TestClient) -> None:
    response = client.post("/auth/login", content=b"x" * (MAX_REQUEST_BODY_BYTES + 1), headers=JSON)
    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large"}


def _chunks(total: int) -> Iterator[bytes]:
    step = 64 * 1024
    for start in range(0, total, step):
        yield b"x" * min(step, total - start)


def test_oversized_chunked_body_is_refused(client: TestClient) -> None:
    # A generator gives httpx no length to declare, so only the count can refuse it.
    response = client.post("/auth/login", content=_chunks(MAX_REQUEST_BODY_BYTES + 1), headers=JSON)
    assert response.status_code == 413


def test_body_at_the_limit_reaches_the_route(client: TestClient) -> None:
    # 422, not 413: the body cleared the middleware and failed validation instead,
    # which pins the boundary at exactly MAX_REQUEST_BODY_BYTES.
    response = client.post("/auth/login", content=b"x" * MAX_REQUEST_BODY_BYTES, headers=JSON)
    assert response.status_code == 422


def test_overflow_outside_an_exception_handler_is_still_a_413() -> None:
    # Routed requests read the body under FastAPI's handlers, which answer the
    # raised 413 themselves; the middleware's own catch is the backstop for a read
    # that happens outside their reach.
    sent: list[Message] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await receive()

    async def receive() -> Message:
        return {"type": "http.request", "body": b"x" * (MAX_REQUEST_BODY_BYTES + 1)}

    async def send(message: Message) -> None:
        sent.append(message)

    async def run() -> None:
        await RequestBodyLimitMiddleware(app)({"type": "http", "headers": []}, receive, send)

    anyio.run(run)
    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 413


def test_overflow_after_a_started_response_propagates() -> None:
    # Once a response has started, a 413 would be a second http.response.start, which
    # is an ASGI protocol violation, so the middleware must re-raise instead.
    sent: list[Message] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await receive()

    async def receive() -> Message:
        return {"type": "http.request", "body": b"x" * (MAX_REQUEST_BODY_BYTES + 1)}

    async def send(message: Message) -> None:
        sent.append(message)

    async def run() -> None:
        await RequestBodyLimitMiddleware(app)({"type": "http", "headers": []}, receive, send)

    with pytest.raises(_BodyTooLarge):
        anyio.run(run)
    assert sent == [{"type": "http.response.start", "status": 200, "headers": []}]


def test_unreadable_declared_length_is_left_to_the_count() -> None:
    # int() cannot read this header, and a ValueError escaping the middleware would be
    # a 500 rather than a refusal; the request passes and the count bounds it instead.
    sent: list[Message] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await receive()
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive() -> Message:
        return {"type": "http.request", "body": b"x"}

    async def send(message: Message) -> None:
        sent.append(message)

    async def run() -> None:
        scope: Scope = {"type": "http", "headers": [(b"content-length", b"not-a-number")]}
        await RequestBodyLimitMiddleware(app)(scope, receive, send)

    anyio.run(run)
    assert sent[0]["status"] == 204


def test_non_body_messages_are_not_counted() -> None:
    # An http.disconnect has no body; the count must ignore it rather than crash on
    # the missing key.
    sent: list[Message] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await receive()
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive() -> Message:
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        sent.append(message)

    async def run() -> None:
        await RequestBodyLimitMiddleware(app)({"type": "http", "headers": []}, receive, send)

    anyio.run(run)
    assert sent[0]["status"] == 204
