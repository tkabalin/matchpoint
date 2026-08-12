"""Outbound email, behind a seam the tests can trust and a provider can drop into.

The sender lives on `app.state`, built in `create_app` like the rate limiters, so
every test app gets one that cannot reach the wire — a test that wants to read what
was sent swaps in its own recorder, and none can send real mail by accident. Which
sender gets built is `settings.email_sender`'s choice, so the day a real provider
arrives (#48) it drops in as a new name here and a line of configuration, with the
routes none the wiser.

Only the logging sender exists yet, and it must never be what production runs: a
deployed 202 whose email went to the log is a sign-up flow that looks alive and
verifies nobody.
"""

import logging
from collections.abc import Callable
from typing import Protocol

from matchpoint_api.config import settings

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    """What a route needs from email: one message, delivered."""

    def send(self, *, to: str, subject: str, body: str) -> None: ...  # pragma: no cover


class LoggingEmailSender:
    """Writes the message to the log instead of the wire.

    The body carries the OTP, which here is the point: in local dev the log is where
    you read the code the flow "sent" you.
    """

    def send(self, *, to: str, subject: str, body: str) -> None:
        logger.info("to %s: %s\n%s", to, subject, body)


def create_email_sender() -> EmailSender:
    # A dict rather than an if-chain so that adding a provider is one entry, and so
    # the setting is honestly what selects — settings.email_sender's Literal type is
    # what rejects a name that isn't here, at startup rather than at first send.
    senders: dict[str, Callable[[], EmailSender]] = {"logging": LoggingEmailSender}
    return senders[settings.email_sender]()
