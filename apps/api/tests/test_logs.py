"""The request log: one JSON line per request, an id on both ends, no secrets.

Assertions read the rendered stderr lines rather than structlog's capture hook, on
purpose: redaction and the contextvars merge live in the processor chain, and only
the rendered output proves the chain that production runs.
"""

import io
import json
import logging
import sys
from typing import Any

import pytest
import structlog
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.auth import SESSION_COOKIE, hash_otp
from matchpoint_api.logs import REQUEST_ID_HEADER, REQUEST_ID_SHAPE, configure_logging
from tests.conftest import crashing_client
from tests.factories import (
    make_coach,
    make_email_verification,
    make_password_reset,
    sign_in,
)


def _json_lines(capfd: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    return [
        json.loads(line) for line in capfd.readouterr().err.splitlines() if line.startswith("{")
    ]


def _request_lines(capfd: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    return [line for line in _json_lines(capfd) if line.get("event") == "request"]


# --- The id on the response ---


def test_every_response_carries_a_request_id(client: TestClient) -> None:
    response = client.get("/health")

    assert REQUEST_ID_SHAPE.fullmatch(response.headers[REQUEST_ID_HEADER])


def test_a_well_formed_inbound_id_is_kept(client: TestClient) -> None:
    response = client.get("/health", headers={REQUEST_ID_HEADER: "abc-DEF_123"})

    assert response.headers[REQUEST_ID_HEADER] == "abc-DEF_123"


@pytest.mark.parametrize("inbound", ["has spaces", "x" * 65, "semi;colon", "new\tline"])
def test_a_malformed_inbound_id_is_replaced(client: TestClient, inbound: str) -> None:
    """The header is untrusted input headed for the log: anything outside the safe
    shape is discarded and a generated id answers instead."""
    response = client.get("/health", headers={REQUEST_ID_HEADER: inbound})

    returned = response.headers[REQUEST_ID_HEADER]
    assert returned != inbound
    assert REQUEST_ID_SHAPE.fullmatch(returned)


# --- The request line ---


def test_each_request_logs_one_line_with_the_documented_fields(
    client: TestClient, capfd: pytest.CaptureFixture[str]
) -> None:
    response = client.get("/health")

    [line] = _request_lines(capfd)
    assert line["method"] == "GET"
    assert line["path"] == "/health"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], float)
    assert line["level"] == "info"
    assert line["request_id"] == response.headers[REQUEST_ID_HEADER]
    assert "coach_id" not in line


def test_an_authenticated_request_logs_the_coach_id(
    client: TestClient, db_session: Session, capfd: pytest.CaptureFixture[str]
) -> None:
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)

    assert client.get("/coaches/me").status_code == 200

    [line] = _request_lines(capfd)
    assert line["coach_id"] == str(coach.id)


def test_a_response_no_route_saw_is_logged_too(
    client: TestClient, capfd: pytest.CaptureFixture[str]
) -> None:
    """Pins the middleware order create_app sets up: the origin check refuses a foreign
    write before any route runs, and this line is the only record such a request leaves."""
    response = client.post("/auth/login", json={}, headers={"Origin": "https://elsewhere.example"})

    assert response.status_code == 403
    [line] = _request_lines(capfd)
    assert line["status"] == 403
    assert line["request_id"] == response.headers[REQUEST_ID_HEADER]


def test_a_crashed_handler_still_gets_its_line(capfd: pytest.CaptureFixture[str]) -> None:
    response = crashing_client().get("/boom")
    assert response.status_code == 500

    [line] = _request_lines(capfd)
    assert line["status"] == 500
    assert line["level"] == "error"
    # The traceback rides inside the same line, so compose's size-based log
    # rotation can never shear it in half.
    assert "RuntimeError" in line["exception"]
    # The id on the generic body the client got is the id on this line, which is the whole
    # of what makes a reported 500 findable: nothing else about it reaches the client.
    assert line["request_id"] == response.headers[REQUEST_ID_HEADER]


def test_a_line_logged_inside_a_route_inherits_the_request_id(
    client: TestClient, capfd: pytest.CaptureFixture[str]
) -> None:
    """request-otp's email goes through mail.py's ordinary stdlib logger, in a worker
    thread. If that line carries the id, any line logged anywhere in a request does."""
    response = client.post("/auth/request-otp", json={"email": "new@example.com"})

    assert response.status_code == 202
    [mail_line] = [
        line for line in _json_lines(capfd) if line.get("logger") == "matchpoint_api.mail"
    ]
    assert mail_line["request_id"] == response.headers[REQUEST_ID_HEADER]


# --- Keeping secrets out ---


def test_no_secret_from_the_auth_flows_reaches_the_log(
    client: TestClient, db_session: Session, capfd: pytest.CaptureFixture[str]
) -> None:
    """The issue's required test: run every flow that handles a credential and assert
    none of the credential values appear anywhere in what was written to stderr."""
    password = "correct-horse-battery-st4ple!"
    signup_otp, reset_otp = "731942", "804615"
    new_password = "st4ple-battery-horse-correct?"

    make_email_verification(db_session, email="new@example.com", otp_hash=hash_otp(signup_otp))
    db_session.commit()
    assert (
        client.post(
            "/auth/verify-otp", json={"email": "new@example.com", "otp": signup_otp}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/coaches",
            json={"email": "new@example.com", "display_name": "Coach", "password": password},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/auth/login", json={"email": "new@example.com", "password": password}
        ).status_code
        == 200
    )
    session_token = client.cookies[SESSION_COOKIE]

    coach = make_coach(db_session)
    make_password_reset(db_session, coach_id=coach.id, otp_hash=hash_otp(reset_otp))
    db_session.commit()
    assert (
        client.post(
            "/auth/verify-reset-code", json={"email": coach.email, "otp": reset_otp}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/auth/reset-password",
            json={"email": coach.email, "new_password": new_password},
        ).status_code
        == 204
    )

    output = capfd.readouterr().err
    assert '"event": "request"' in output  # the capture worked; the assertions below mean something
    for secret in (password, new_password, signup_otp, reset_otp, session_token):
        assert secret not in output


def test_secret_named_fields_are_redacted_at_any_depth(
    capfd: pytest.CaptureFixture[str],
) -> None:
    """The backstop for log calls the by-design request line cannot see: any field
    whose key merely contains a secret stem loses its value before rendering."""
    configure_logging()
    structlog.stdlib.get_logger("test").info(
        "evt",
        password="p1",
        session_token="t1",
        authorization="Bearer x",
        nested={"reset_otp": "731942", "kept": "visible"},
        items=[{"cookie": "c1"}, "plain"],
        pair=({"secret": "s1"},),
        kept="visible-too",
    )

    [line] = _json_lines(capfd)
    assert line["password"] == "[redacted]"
    assert line["session_token"] == "[redacted]"
    assert line["authorization"] == "[redacted]"
    assert line["nested"] == {"reset_otp": "[redacted]", "kept": "visible"}
    assert line["items"] == [{"cookie": "[redacted]"}, "plain"]
    assert line["pair"] == [{"secret": "[redacted]"}]
    assert line["kept"] == "visible-too"


# --- Output plumbing ---


class _Tty(io.StringIO):
    def isatty(self) -> bool:
        return True


def test_a_tty_gets_console_lines_and_a_pipe_gets_json(
    monkeypatch: pytest.MonkeyPatch, capfd: pytest.CaptureFixture[str]
) -> None:
    fake_tty = _Tty()
    monkeypatch.setattr(sys, "stderr", fake_tty)
    configure_logging()
    structlog.stdlib.get_logger("test").info("console_probe")

    assert "console_probe" in fake_tty.getvalue()
    assert not fake_tty.getvalue().startswith("{")

    monkeypatch.undo()
    configure_logging()
    structlog.stdlib.get_logger("test").info("json_probe")

    [line] = _json_lines(capfd)
    assert line["event"] == "json_probe"


def test_uvicorns_loggers_are_rerouted_and_its_access_log_dropped() -> None:
    """Startup and error lines join the JSON stream; the access line is replaced by
    the middleware's richer one rather than duplicated in a second format."""
    configure_logging()

    for name in ("uvicorn", "uvicorn.error"):
        assert logging.getLogger(name).handlers == []
        assert logging.getLogger(name).propagate
    access = logging.getLogger("uvicorn.access")
    assert access.handlers == []
    assert not access.propagate
