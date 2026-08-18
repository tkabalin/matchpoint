"""Outbound email, behind a seam the tests can trust and the provider drops into.

The sender lives on `app.state`, built in `create_app` like the rate limiters, so
every test app gets one that cannot reach the wire — a test that wants to read what
was sent swaps in its own recorder, and none can send real mail by accident. Which
sender gets built is `settings.email_sender`'s choice, so a second provider is one
class and one entry in `create_email_sender`, with the routes none the wiser.

Neither `LoggingEmailSender` nor `FileEmailSender` must ever be what production runs: a
deployed 202 whose email went to a log or a file is a sign-up flow that looks alive and
verifies nobody. What stops that is `infra/prod/compose.yml`, which names the real sender
and refuses to start without a key for it.
"""

import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

import httpx

from matchpoint_api.config import settings

logger = logging.getLogger(__name__)

# A module constant rather than a Settings field: there is one Resend account behind
# one verified sending domain, so there is nothing for a second value to be. It
# promotes to configuration the day a second sender or domain exists.
#
# Domain-level verification means any local part at thomaskabalin.com authenticates,
# so changing this address costs nothing in DNS — but subdomains are not covered, and
# a later mail.thomaskabalin.com would need verifying in its own right.
#
# Nothing receives replies: a coach who answers a sign-up code gets a bounce. Accepted,
# because the message is a six-digit code and not correspondence. Wanting replies to
# land somewhere later is a Reply-To header, not a change of sender.
EMAIL_FROM = "MatchPoint <noreply@thomaskabalin.com>"

RESEND_URL = "https://api.resend.com/emails"

# Short, and explicit because httpx's default is not: the send happens inside the request
# (routers/auth.py says why it cannot be deferred), holding an anyio worker thread for as
# long as the provider takes.
RESEND_TIMEOUT = httpx.Timeout(5.0, connect=3.0)

# What a 429 waits before its one retry. Fixed rather than the Retry-After the provider
# sends, which can be further out than a request holding a thread can afford to wait;
# Resend admits 2 requests a second, so a token exists again well inside this.
RESEND_RETRY_WAIT = 0.5


class EmailSendError(Exception):
    """The message did not get as far as the provider accepting it.

    Raised in place of anything provider-shaped so that a route can answer for a failed
    send without importing httpx or knowing who is behind the seam.
    """


class EmailSender(Protocol):
    """What a route needs from email: one message, delivered.

    `text` is the whole body for now. A branded HTML template is a keyword argument
    beside it rather than a replacement, so adding one leaves every call site here and
    in the tests as it is.
    """

    def send(self, *, to: str, subject: str, text: str) -> None: ...  # pragma: no cover


class LoggingEmailSender:
    """Writes the message to the log instead of the wire.

    The body carries the OTP, which here is the point: in local dev the log is where
    you read the code the flow "sent" you.
    """

    def send(self, *, to: str, subject: str, text: str) -> None:
        logger.info("to %s: %s\n%s", to, subject, text)


class FileEmailSender:
    """Appends the message to a file as one line of JSON, instead of the wire.

    For the Playwright suite, which drives the real sign-up flow and so has to read the
    code the API "sent" it. A file rather than the log because the runner starts the API
    as a child process (`scripts/e2e-api.sh`) and does not own its output stream.
    """

    def __init__(self, path: Path) -> None:
        self._path = path

    def send(self, *, to: str, subject: str, text: str) -> None:
        message = json.dumps({"to": to, "subject": subject, "text": text})
        # One append of one short line, which the kernel writes whole: browser projects
        # run in parallel, so several sign-ups can be sending at once.
        with self._path.open("a", encoding="utf-8") as file:
            file.write(f"{message}\n")


class ResendEmailSender:
    """Hands the message to Resend's HTTP API.

    A failed send raises `EmailSendError`, and only a 429 is retried: the endpoint mints
    a fresh code per request, so a coach's "resend code" is the retry for anything else,
    while a 429 is the one failure this app manufactures rather than suffers — the
    provider admits 2 requests a second and `request_otp_total_limit`'s burst is larger.
    """

    def __init__(self, api_key: str, client: httpx.Client | None = None) -> None:
        # One client, so sends reuse the TLS connection rather than repeating the
        # handshake inside a request. Injectable so the tests can drive a MockTransport
        # through the real send path, which is Resend's own guidance for staying off the
        # account's quota.
        self._client = client or httpx.Client(timeout=RESEND_TIMEOUT)
        self._headers = {"Authorization": f"Bearer {api_key}"}

    def send(self, *, to: str, subject: str, text: str) -> None:
        message = {"from": EMAIL_FROM, "to": [to], "subject": subject, "text": text}
        try:
            response = self._client.post(RESEND_URL, headers=self._headers, json=message)
            if response.status_code == 429:
                # Once, and only for this status — the class docstring says why.
                time.sleep(RESEND_RETRY_WAIT)
                response = self._client.post(RESEND_URL, headers=self._headers, json=message)
            response.raise_for_status()
        # HTTPStatusError is an HTTPError, so a refusal and a connection that never got
        # an answer both land here — either way the message did not get sent.
        except httpx.HTTPError as exc:
            # The provider's response body is logged because the reason is only ever in
            # there: str(exc) is the status line alone, so a dead key and a domain that
            # stopped verifying read identically. Our own body never is — it holds a
            # live OTP, and Resend's errors name the field they object to, not its value.
            reason = exc.response.text if isinstance(exc, httpx.HTTPStatusError) else ""
            logger.exception("failed to send to %s: %s", to, reason)
            raise EmailSendError(str(exc)) from exc
        # The id a send is looked up by when someone reports a code that never arrived.
        # An unreadable body costs the id and nothing else: the 2xx already means Resend
        # has the message, so a failure here would answer 502 for an email that went.
        try:
            message_id = response.json().get("id")
        except ValueError:
            message_id = "unreadable response body"
        logger.info("sent to %s: %s", to, message_id)


def _file_sender() -> EmailSender:
    """Read the path out of settings, refusing the half-configured case as resend does."""
    if settings.email_file is None:
        raise RuntimeError("MATCHPOINT_EMAIL_SENDER=file needs MATCHPOINT_EMAIL_FILE set")
    return FileEmailSender(settings.email_file)


def _resend_sender() -> EmailSender:
    """Read the key out of settings, refusing the half-configured case.

    Here rather than in `ResendEmailSender`, which stays a plain sender that takes a key
    — that is what lets a test build one without going through configuration at all.
    """
    api_key = settings.resend_api_key.get_secret_value()
    if not api_key:
        # At startup, because this is called from create_app: a box told to send with
        # nothing to send through fails to boot, rather than answering 502 to the first
        # coach who tries to sign up. compose.yml's ${RESEND_API_KEY:?} catches the same
        # mistake one layer earlier, and neither makes the other redundant — that one
        # cannot see a key set to a blank string in a .env we do not manage.
        raise RuntimeError("MATCHPOINT_EMAIL_SENDER=resend needs MATCHPOINT_RESEND_API_KEY set")
    return ResendEmailSender(api_key)


def create_email_sender() -> EmailSender:
    # A dict rather than an if-chain so that adding a provider is one entry, and so
    # the setting is honestly what selects — settings.email_sender's Literal type is
    # what rejects a name that isn't here, at startup rather than at first send.
    senders: dict[str, Callable[[], EmailSender]] = {
        "logging": LoggingEmailSender,
        "file": _file_sender,
        "resend": _resend_sender,
    }
    return senders[settings.email_sender]()
