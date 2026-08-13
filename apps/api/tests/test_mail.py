"""Unit tests for the outbound-email seam — no fixtures, no database.

The route-level proof that create_app wires the seam lives in
`tests/routers/test_auth.py`; these cover the module's own promises.
"""

import logging

import pytest

from matchpoint_api.mail import LoggingEmailSender, create_email_sender


def test_the_selected_sender_is_the_logging_one() -> None:
    """settings.email_sender's Literal admits nothing else yet, so this is what every
    test app — and, until #48, everything else — gets handed: a sender that cannot
    reach the wire."""
    assert isinstance(create_email_sender(), LoggingEmailSender)


def test_the_logging_sender_writes_the_whole_message_to_the_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The body included, deliberately: in local dev the log is where you go to read
    the code the flow 'sent' you."""
    with caplog.at_level(logging.INFO, logger="matchpoint_api.mail"):
        LoggingEmailSender().send(to="new@example.com", subject="Your code", text="123456")

    assert "new@example.com" in caplog.text
    assert "Your code" in caplog.text
    assert "123456" in caplog.text
