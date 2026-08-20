"""Structured logging: JSON lines on stderr, one line per request, an id on both.

Free text has to be grepped; these lines are JSON objects, so a production question
is a field filter: every line for one request id, everything a coach did, every 500.
The id comes from the middleware below, rides the response as a header, and reaches
every line logged while handling the request, which is what ties a coach's report to
the traceback behind it.

Secrets stay out by construction: the request line carries method, path, status,
duration and ids, never a body, header or query value, so tokens and passwords have
no path in. `redact_secrets` is the backstop for log calls this design cannot see,
the same posture `errors.py` takes for the 422 body.
"""

import logging
import re
import sys
import time
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, TextIO

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from structlog.typing import EventDict, Processor

logger = structlog.stdlib.get_logger(__name__)

REQUEST_ID_HEADER = "X-Request-Id"

# An inbound id is honoured so a caller can correlate its records with ours, but it is
# untrusted input headed straight for the log: anything long or outside this alphabet
# is replaced, not written.
REQUEST_ID_SHAPE = re.compile(r"[A-Za-z0-9_-]{1,64}")

# Key stems, not exact names: errors.py can enumerate its schemas' secret fields, but
# a backstop has to catch keys that do not exist yet (session_token, reset_otp, ...),
# so it trades the odd false positive for coverage.
SECRET_KEY_STEMS = ("password", "token", "otp", "secret", "cookie", "authorization")

REDACTED = "[redacted]"


def _redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        mapping: Mapping[Any, Any] = value
        return {
            key: REDACTED if _is_secret(key) else _redact(item) for key, item in mapping.items()
        }
    if isinstance(value, (list, tuple)):
        items: Sequence[Any] = value
        return [_redact(item) for item in items]
    return value


def _is_secret(key: object) -> bool:
    return isinstance(key, str) and any(stem in key.lower() for stem in SECRET_KEY_STEMS)


def redact_secrets(_logger: object, _method: str, event_dict: EventDict) -> EventDict:
    """Replace the value of any secret-named field, at any depth, on every line."""
    return _redact(dict(event_dict))


class _LiveStderrHandler(logging.StreamHandler[TextIO]):
    """A StreamHandler that resolves sys.stderr at each write, not at creation.

    Pinning the object at creation is StreamHandler's default, and it logs into the
    void anywhere stderr gets swapped after configuration; pytest does so per test.
    The stdlib's own lastResort handler resolves late for the same reason.
    """

    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stderr
        super().emit(record)


def configure_logging() -> None:
    """Route everything onto stderr through one processor chain (structlog calls,
    mail.py's stdlib logger, uvicorn's own), so the container emits a single stream.

    Called from create_app and idempotent: this module's own handler is replaced
    rather than appended, so the test suite's many apps do not stack copies.
    """
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        redact_secrets,
    ]
    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=False,
    )
    # A tty gets structlog's aligned, coloured console lines; anything captured (the
    # containers, CI) gets JSON. format_exc_info keeps a traceback inside its line,
    # which is what stops compose's log rotation shearing one in half.
    renderer: Processor = (
        structlog.dev.ConsoleRenderer()
        if sys.stderr.isatty()
        else structlog.processors.JSONRenderer()
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.format_exc_info,
            renderer,
        ],
    )
    handler = _LiveStderrHandler()
    handler.setFormatter(formatter)
    root = logging.getLogger()
    # Only this module's handler is dropped, so a repeat call neither stacks copies nor
    # removes one someone else owns: pytest keeps caplog's on root.
    root.handlers = [h for h in root.handlers if not isinstance(h, _LiveStderrHandler)]
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    # uvicorn attaches plain-text handlers of its own at startup; stripping them after
    # (this module imports later) sends its startup and error lines through the root
    # handler like everything else.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    # Dropped rather than restyled: the middleware below logs a richer line per
    # request, and a second copy in another format only spends the log budget twice.
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False


class RequestLogMiddleware(BaseHTTPMiddleware):
    """One structured line per request, under an id every other line shares.

    Outermost on purpose (create_app adds it last): the id must be bound before
    anything else can log, and the line should record the status the wire saw. The
    id is bound as a contextvar, which every task and worker thread spawned for the
    request inherits, so a line logged from inside a route carries it unasked.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        structlog.contextvars.clear_contextvars()
        inbound = request.headers.get(REQUEST_ID_HEADER)
        request_id = (
            inbound if inbound and REQUEST_ID_SHAPE.fullmatch(inbound) else uuid.uuid4().hex
        )
        structlog.contextvars.bind_contextvars(request_id=request_id)
        # On the scope as well, for the coach id's reason below: the handler that shapes
        # the unhandled-exception 500 runs above this middleware, so the header it sets
        # can only come from what the request itself carries.
        request.state.request_id = request_id
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # The 500 this becomes is built by Starlette's outermost handler, which this
            # response never was, so the line here is the only record of the traceback,
            # under the id that handler answers with.
            self._log_request(request, status=500, start=start, exc_info=True)
            raise
        response.headers[REQUEST_ID_HEADER] = request_id
        self._log_request(request, status=response.status_code, start=start)
        return response

    def _log_request(
        self, request: Request, *, status: int, start: float, exc_info: bool = False
    ) -> None:
        fields: dict[str, Any] = {
            "method": request.method,
            "path": request.url.path,
            "status": status,
            "duration_ms": round((time.perf_counter() - start) * 1000, 1),
        }
        # Through request.state rather than a contextvar: the dependency that knows
        # the coach runs in a worker thread, and a bind there stays in that thread's
        # copy of the context; the ASGI scope is what the two genuinely share.
        coach_id = getattr(request.state, "log_coach_id", None)
        if coach_id is not None:
            fields["coach_id"] = str(coach_id)
        # One principal per request in practice, but stamped independently: a line
        # names whichever the resolving dependency proved, under its own field.
        player_id = getattr(request.state, "log_player_id", None)
        if player_id is not None:
            fields["player_id"] = str(player_id)
        log = logger.error if status >= 500 else logger.info
        log("request", exc_info=exc_info, **fields)
