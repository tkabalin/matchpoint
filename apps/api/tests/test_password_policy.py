"""Unit tests for the local password policy: no fixtures, no database.

Both halves matter. A rule too loose lets `12345678` through, and nothing else in the
API would notice; a rule too tight refuses a password a coach reasonably chose, which is
a coach stuck on the sign-up screen. The accepted cases below are as much the point as
the refused ones.
"""

import pytest
from fastapi import HTTPException

from matchpoint_api.password_policy import (
    COMMON,
    CONTEXT,
    REPEATED,
    SEQUENTIAL,
    check_password,
    rejection_reason,
)

EMAIL = "mike.smith@example.com"
DISPLAY_NAME = "Coach Mike"


def _reason(password: str, email: str = EMAIL, display_name: str = DISPLAY_NAME) -> str | None:
    return rejection_reason(password, email=email, display_name=display_name)


@pytest.mark.parametrize(
    "password",
    [
        "aaaaaaaa",
        "aaaaa123",
        "AAAAaaaa",  # folded before counting, so a change of case is not a change of character
        "a1a2a3a4a",  # spread rather than a run, which counting catches and scanning would not
    ],
)
def test_a_password_that_is_mostly_one_character_is_refused(password: str) -> None:
    assert _reason(password) == REPEATED


@pytest.mark.parametrize(
    "password",
    [
        "12345678",
        "abcdefgh",
        "87654321",  # the reverses: the run is counted in both directions
        "hgfedcba",
        "wimbledon12345",  # a five-run is enough, wherever in the password it sits
        "１２３４５６７８",  # fullwidth digits, NFKC 12345678
    ],
)
def test_a_password_running_through_consecutive_characters_is_refused(password: str) -> None:
    assert _reason(password) == SEQUENTIAL


@pytest.mark.parametrize(
    "password",
    [
        "password",
        "PASSWORD",
        "matchpoint",  # this service's own name, which NIST asks for by name
        "password!",  # the whole point of `_bare`: one character would otherwise clear it
        "Password123!",
        "monkey123",  # and the shorter entries, which only a stripped match can reach
        "tennis12345",  # ahead of the sequence rule, since the reason is the more useful one
    ],
)
def test_a_common_password_is_refused(password: str) -> None:
    """A blocklist a trailing character defeats is a blocklist that refuses nothing: the
    eight-character floor is met by `password1`, so the stripped form is matched too."""
    assert _reason(password) == COMMON


@pytest.mark.parametrize(
    "password",
    [
        "the-mike-special",  # a word of the display name
        "coach-of-the-year",  # the other word of it
        "smith-and-wesson",  # the email local part splits, so `mike.smith@` gives up `smith`
        "MikeSmith-forever",  # matched case-insensitively, as a coach's own capitals vary
    ],
)
def test_a_password_carrying_the_coach_s_own_words_is_refused(password: str) -> None:
    assert _reason(password) == CONTEXT


@pytest.mark.parametrize(
    "password",
    [
        "a-good-password",  # the suite's own sign-up password, and it contains "password"
        "correct-horse-battery-st4ple!",
        "wimbledon-in-the-rain",  # a doubled letter and a two-character run, both ordinary
        "secret-garden-path",  # `_bare` strips the tail, it does not squash the string
    ],
)
def test_an_ordinary_password_is_accepted(password: str) -> None:
    """The refusals above are worth nothing if a passphrase cannot get past them. The
    first case is why the blocklist matches whole passwords: `a-good-password` contains a
    listed word, and refusing it would break every sign-up in this suite."""
    assert _reason(password) is None


def test_a_short_name_is_not_matched_as_a_substring() -> None:
    """Below the needle floor the rule stops protecting anyone and starts refusing at
    random: two letters from a name are a substring of most things a coach would type."""
    assert _reason("the-alpine-jonquil", email="jo@example.com", display_name="Al") is None


def test_the_first_matching_rule_is_the_one_reported() -> None:
    """A password can fail several rules and still only needs one thing said about it, so
    the order the rules run in is the order they are reported in."""
    assert _reason("aaaaaa12345") == REPEATED


def test_the_refusal_is_a_400_carrying_the_reason() -> None:
    """A 400 rather than a 422: FastAPI declares every route's 422 as a list of field
    errors, so a sentence under `detail` there is a body the generated client misreads."""
    with pytest.raises(HTTPException) as raised:
        check_password("aaaaaaaa", email=EMAIL, display_name=DISPLAY_NAME)

    assert raised.value.status_code == 400
    assert raised.value.detail == REPEATED


def test_an_accepted_password_raises_nothing() -> None:
    check_password("a-good-password", email=EMAIL, display_name=DISPLAY_NAME)
