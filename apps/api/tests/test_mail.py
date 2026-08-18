"""Unit tests for the outbound-email seam — no fixtures, no database, no network.

The route-level proof that create_app wires the seam lives in
`tests/routers/test_auth.py`; these cover the module's own promises.

`ResendEmailSender` is exercised through a `MockTransport`, so the real send path runs —
request built, status checked, failures translated — with nothing leaving the process.
That is Resend's own guidance for a test suite: mocking is what keeps one off the
account's sending quota, and every address below would be refused by the live API
anyway, `@example.com` being a domain they answer 422 to on principle.
"""

import json
import logging
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from matchpoint_api import mail
from matchpoint_api.config import Settings, settings
from matchpoint_api.mail import (
    EMAIL_FROM,
    EmailSendError,
    FileEmailSender,
    LoggingEmailSender,
    ResendEmailSender,
    create_email_sender,
)

Handler = Callable[[httpx.Request], httpx.Response]

# Stand-in for a rendered template: what these tests care about is that the second body
# is carried, not what is in it. `email_templates.py` is where the markup is a subject.
HTML = "<p>123456</p>"


def _sender_answering(handler: Handler) -> ResendEmailSender:
    """A sender whose transport is the given handler, and whose key is not a real one."""
    return ResendEmailSender("re_test", client=httpx.Client(transport=httpx.MockTransport(handler)))


def _ok(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"id": "abc-123"})


def test_the_default_sender_cannot_send() -> None:
    """The invariant a fresh checkout depends on, and the reason `tests/__init__.py` pins
    the setting for the whole run: nothing sends real mail without being told to.

    Read off the field rather than the live `settings`, which that pin has already
    overridden — the question here is what someone with no .env at all gets.
    """
    assert Settings.model_fields["email_sender"].default == "logging"


def test_the_selected_sender_is_the_logging_one() -> None:
    """And the setting resolves to it, which is the half the field default cannot show."""
    assert isinstance(create_email_sender(), LoggingEmailSender)


def test_the_logging_sender_writes_the_message_to_the_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The body included, deliberately: in local dev the log is where you go to read
    the code the flow 'sent' you."""
    with caplog.at_level(logging.INFO, logger="matchpoint_api.mail"):
        LoggingEmailSender().send(
            to="new@example.com", subject="Your code", text="123456", html=HTML
        )

    assert "new@example.com" in caplog.text
    assert "Your code" in caplog.text
    assert "123456" in caplog.text


def test_the_logging_sender_leaves_the_markup_out(caplog: pytest.LogCaptureFixture) -> None:
    """The half a person reading a dev log wants is the plain-text one. A template's worth
    of tags around the code is how the code stops being findable."""
    with caplog.at_level(logging.INFO, logger="matchpoint_api.mail"):
        LoggingEmailSender().send(
            to="new@example.com", subject="Your code", text="123456", html="<p>markup</p>"
        )

    assert "markup" not in caplog.text


def test_the_resend_sender_posts_the_message_to_the_api() -> None:
    """The whole request, because every part of it matters: the bearer key, the verified
    From address, and both bodies. One under the wrong key sends a blank email, and
    `html` alone would leave a text-only client with nothing to show."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _ok(request)

    _sender_answering(handler).send(
        to="new@example.com", subject="Your code", text="123456", html=HTML
    )

    [request] = seen
    assert request.method == "POST"
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == "Bearer re_test"
    assert json.loads(request.content) == {
        "from": EMAIL_FROM,
        "to": ["new@example.com"],
        "subject": "Your code",
        "text": "123456",
        "html": HTML,
    }


def test_the_resend_sender_logs_the_provider_id(caplog: pytest.LogCaptureFixture) -> None:
    """Which is how a send gets looked up in Resend's dashboard when a coach reports a
    code that never arrived."""
    with caplog.at_level(logging.INFO, logger="matchpoint_api.mail"):
        _sender_answering(_ok).send(
            to="new@example.com", subject="Your code", text="123456", html=HTML
        )

    assert "abc-123" in caplog.text


def test_a_refused_send_raises_email_send_error() -> None:
    """A 4xx from the provider — a bad key, or the 422 an address they refuse earns. The
    route turns this into its 502, so it must not arrive as an httpx type."""
    sender = _sender_answering(
        lambda _request: httpx.Response(422, json={"message": "Invalid `to` field"})
    )

    with pytest.raises(EmailSendError):
        sender.send(to="new@example.com", subject="Your code", text="123456", html=HTML)


def test_a_stalled_send_raises_email_send_error() -> None:
    """The failure RESEND_TIMEOUT exists to produce. It arrives as a different httpx
    exception from a refusal and must land as the same thing here, or a hung provider is
    a 500 instead of the declared 502."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("too slow")

    with pytest.raises(EmailSendError):
        _sender_answering(handler).send(
            to="new@example.com", subject="Your code", text="123456", html=HTML
        )


def test_a_rate_limited_send_is_retried_and_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    """The one failure retried in here, because it is the one the app's own burst size
    manufactures: several coaches tapping at once outrun the provider's 2 requests a
    second, and a 502 for that is a code nobody gets over a wait of half a second."""
    monkeypatch.setattr(mail, "RESEND_RETRY_WAIT", 0)
    answers = [
        httpx.Response(429, json={"name": "rate_limit_exceeded"}),
        httpx.Response(200, json={"id": "abc-123"}),
    ]

    _sender_answering(lambda _request: answers.pop(0)).send(
        to="new@example.com", subject="Your code", text="123456", html=HTML
    )

    assert answers == []


def test_a_send_rate_limited_twice_still_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """One retry, not a loop: past that the request is holding a threadpool thread
    against a provider that is refusing, and the route's 502 is the better answer."""
    monkeypatch.setattr(mail, "RESEND_RETRY_WAIT", 0)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(429, json={"name": "rate_limit_exceeded"})

    with pytest.raises(EmailSendError):
        _sender_answering(handler).send(
            to="new@example.com", subject="Your code", text="123456", html=HTML
        )

    assert len(seen) == 2


def test_an_unreadable_success_body_is_still_a_send() -> None:
    """The 2xx is what means Resend has the message, so a body that will not parse must
    cost the logged id and nothing more. Raising would answer 502 for an email that went,
    and the retry that asks for would replace the code already on its way."""
    sender = _sender_answering(lambda _request: httpx.Response(200, text="<html>nope</html>"))

    sender.send(to="new@example.com", subject="Your code", text="123456", html=HTML)


def test_a_refused_send_logs_the_provider_s_reason(caplog: pytest.LogCaptureFixture) -> None:
    """Which is only in the response body: the exception carries the status line, so a
    domain that stopped verifying and a dead key are the same 403 without it."""
    sender = _sender_answering(
        lambda _request: httpx.Response(403, json={"name": "domain_not_verified"})
    )

    with (
        caplog.at_level(logging.DEBUG, logger="matchpoint_api.mail"),
        pytest.raises(EmailSendError),
    ):
        sender.send(to="new@example.com", subject="Your code", text="123456", html=HTML)

    assert "domain_not_verified" in caplog.text


def test_a_failed_send_keeps_the_code_out_of_the_log(caplog: pytest.LogCaptureFixture) -> None:
    """The logging sender writes the body on purpose; this one must not. A box configured
    to deliver has not agreed to hold live codes in its logs because a send failed."""
    sender = _sender_answering(lambda _request: httpx.Response(500, json={}))

    with (
        caplog.at_level(logging.DEBUG, logger="matchpoint_api.mail"),
        pytest.raises(EmailSendError),
    ):
        sender.send(to="new@example.com", subject="Your code", text="code is 123456", html=HTML)

    assert "new@example.com" in caplog.text
    assert "123456" not in caplog.text


def test_the_file_sender_appends_every_message_as_a_line_of_json(tmp_path: Path) -> None:
    """One line per send, and the body in it: the Playwright suite reads the sign-up code
    back out of this file, and picks its own message out by the address it went to."""
    path = tmp_path / "mail.jsonl"
    sender = FileEmailSender(path)

    sender.send(to="first@example.com", subject="Your code", text="123456", html=HTML)
    sender.send(to="second@example.com", subject="Your code", text="654321", html=HTML)

    assert [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] == [
        {"to": "first@example.com", "subject": "Your code", "text": "123456"},
        {"to": "second@example.com", "subject": "Your code", "text": "654321"},
    ]


def test_the_setting_selects_the_file_sender(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """What scripts/e2e-api.sh relies on, and the half a path on its own cannot show."""
    monkeypatch.setattr(settings, "email_sender", "file")
    monkeypatch.setattr(settings, "email_file", tmp_path / "mail.jsonl")

    assert isinstance(create_email_sender(), FileEmailSender)


def test_selecting_the_file_sender_without_a_path_fails_loudly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Resend's rule for the half-configured case: an e2e run whose mail went nowhere
    readable must not start, since every spec that needs a code would fail instead."""
    monkeypatch.setattr(settings, "email_sender", "file")
    monkeypatch.setattr(settings, "email_file", None)

    with pytest.raises(RuntimeError, match="MATCHPOINT_EMAIL_FILE"):
        create_email_sender()


def test_the_setting_selects_the_resend_sender(monkeypatch: pytest.MonkeyPatch) -> None:
    """What production relies on. monkeypatch rather than assignment because `settings` is
    shared for the session — conftest pins email_sender once and nothing re-pins it."""
    monkeypatch.setattr(settings, "email_sender", "resend")
    monkeypatch.setattr(settings, "resend_api_key", SecretStr("re_x"))

    assert isinstance(create_email_sender(), ResendEmailSender)


def test_selecting_resend_without_a_key_fails_loudly(monkeypatch: pytest.MonkeyPatch) -> None:
    """At startup, because create_app calls this: a box told to send with nothing to send
    through must not boot into answering 502 to every coach who tries to sign up.

    The key is blanked rather than left alone — whoever runs this may have a real one in
    apps/api/.env, and a test that passes only on machines that don't is no test.
    """
    monkeypatch.setattr(settings, "email_sender", "resend")
    monkeypatch.setattr(settings, "resend_api_key", SecretStr(""))

    with pytest.raises(RuntimeError, match="MATCHPOINT_RESEND_API_KEY"):
        create_email_sender()
