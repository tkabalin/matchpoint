"""Unit tests for the two email bodies: no fixtures, no database, no network.

What is asserted is what a mail client, a screen reader or a spam filter would object
to, plus the wording a coach acts on. Not the markup itself: an assertion over the
layout byte for byte would fail on every design change and prove nothing about any of
them. That the routes actually send these is `tests/routers/test_auth.py`'s job.
"""

import re
from collections.abc import Callable
from datetime import timedelta

import pytest

from matchpoint_api.email_templates import Message, password_reset_code, signup_code

Builder = Callable[..., Message]

BUILDERS = [signup_code, password_reset_code]

TEN_MINUTES = timedelta(minutes=10)

# The categorical swatches from .claude/rules/web-color.md. They carry data meaning in
# the app, so none of them may turn up here as decoration.
CATEGORICAL = ["#9C3D0A", "#E69F00", "#EDDD6E", "#1FBF8C", "#2E1A47", "#D9569E"]


@pytest.mark.parametrize("build", BUILDERS)
def test_both_parts_carry_the_code(build: Builder) -> None:
    """The half a client renders is its choice, so the code cannot be in only one."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert "481625" in message.text
    assert "481625" in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_the_code_is_six_unbroken_digits(build: Builder) -> None:
    """Spacing the digits apart for looks would break both the copy a coach makes of it
    and the one-time-code autofill iOS and Android offer for a plain run of six."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert re.search(r"\b481625\b", message.text)
    assert ">481625<" in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_both_parts_say_when_the_code_dies(build: Builder) -> None:
    """Read off the lifetime it is given rather than hardcoded, so the sentence cannot
    keep claiming ten minutes after `auth.py` shortens the code's life."""
    message = build(code="481625", expires_in=timedelta(minutes=7))

    assert "7 minutes" in message.text
    assert "7 minutes" in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_the_subject_names_the_app_and_the_code(build: Builder) -> None:
    """An inbox shows the subject and little else; "Action required" is what a coach
    ignores."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert "MatchPoint" in message.subject
    assert "code" in message.subject.lower()


def test_the_two_emails_are_told_apart_by_their_subjects() -> None:
    """A coach with both in the inbox has to know which one to open."""
    signup = signup_code(code="481625", expires_in=TEN_MINUTES)
    reset = password_reset_code(code="481625", expires_in=TEN_MINUTES)

    assert signup.subject != reset.subject
    assert "sign-up" in signup.subject.lower()
    assert "reset" in reset.subject.lower()


@pytest.mark.parametrize("build", BUILDERS)
def test_an_unasked_for_code_can_be_ignored(build: Builder) -> None:
    """Both emails arrive at addresses that did not necessarily ask for them: anyone can
    type someone else's address into either form. Saying so is what stops the message
    reading like a breach."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert "ignore this email" in message.text
    assert "ignore this email" in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_the_html_is_a_document_a_client_can_read(build: Builder) -> None:
    """The structural pieces assistive technology reads first: the language, the
    direction, and a title, which several clients announce before the body."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert message.html.startswith("<!DOCTYPE html>")
    assert '<html lang="en" dir="ltr">' in message.html
    assert f"<title>{message.subject}</title>" in message.html
    # Repeated on a child of <body> because several clients strip them off <html>.
    assert '<div lang="en" dir="ltr">' in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_every_table_is_marked_presentational(build: Builder) -> None:
    """The layout is tables, so without this a screen reader announces every row and
    cell of it instead of reading the message."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert message.html.count("<table") == message.html.count('role="presentation"')


@pytest.mark.parametrize("build", BUILDERS)
def test_the_message_has_exactly_one_heading(build: Builder) -> None:
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert message.html.count("<h1") == 1


@pytest.mark.parametrize("build", BUILDERS)
def test_the_html_fetches_nothing(build: Builder) -> None:
    """No image, no stylesheet, no webfont. Clients block remote content by default, so
    anything hanging off a URL is a hole in the design for most readers, and a request
    that would tell us the message had been opened, which a code email has no business
    asking."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    for fetched in ["<img", "<link", "src=", "url(", "http://", "https://"]:
        assert fetched not in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_the_brand_blue_dresses_the_message_and_the_data_colors_stay_out(
    build: Builder,
) -> None:
    """.claude/rules/web-color.md's division, in the one place outside apps/web that
    draws anything: blue is chrome, and the categorical swatches mean something on the
    dashboard that they cannot also mean here."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert "#045C8C" in message.html
    for hex_code in CATEGORICAL:
        assert hex_code not in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_the_html_answers_a_dark_mode_client(build: Builder) -> None:
    """Declared rather than left to the client, which would otherwise invert the palette
    itself and can make a poor job of a colored band."""
    message = build(code="481625", expires_in=TEN_MINUTES)

    assert 'name="color-scheme" content="light dark"' in message.html
    assert "prefers-color-scheme: dark" in message.html
    # The body's own light background carries the dark class too, or it frames the card
    # with a light seam in a client that honours the scheme.
    assert 'class="mp-body"' in message.html


@pytest.mark.parametrize("build", BUILDERS)
def test_an_interpolated_value_cannot_carry_markup_into_the_html(build: Builder) -> None:
    """The codes are six digits today. This is what makes interpolating something a
    coach typed, a display name for instance, safe rather than the next person's problem."""
    message = build(code="<b>&", expires_in=TEN_MINUTES)

    assert "&lt;b&gt;&amp;" in message.html
    assert "<b>" not in message.html
    # The text part is not HTML and must not be escaped into looking like it.
    assert "<b>&" in message.text
