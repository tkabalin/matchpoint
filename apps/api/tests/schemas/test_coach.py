"""Unit tests for the coach schemas — no fixtures, no database.

CoachCreate is what a sign-up form is written against, so its bounds are pinned at the
figures the schema itself names rather than restated here. CoachRead's rule is an
omission — password_hash must not be reachable through the schema — which is exactly the
kind of thing that survives a careless edit, because adding the field back looks like
completing the model rather than undoing a decision.
"""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from matchpoint_api.models import Coach
from matchpoint_api.schemas.coach import (
    EMAIL_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    CoachCreate,
    CoachRead,
)


def _sign_up(**overrides: object) -> CoachCreate:
    """Valid input with the field under test substituted in.

    model_validate rather than the constructor, as in test_player.py: it takes the raw
    strings a request body carries, and lets a required field be dropped.
    """
    payload: dict[str, object] = {
        "email": "mike@example.com",
        "display_name": "Coach Mike",
        "password": "a-good-password",
    }
    return CoachCreate.model_validate(payload | overrides)


def test_a_valid_sign_up_parses() -> None:
    data = _sign_up()

    assert data.email == "mike@example.com"
    assert data.display_name == "Coach Mike"
    assert data.password.get_secret_value() == "a-good-password"


def test_the_email_is_stripped_and_its_domain_lowercased() -> None:
    """A pasted address routinely carries a trailing space. The domain is all EmailStr
    folds — the local part keeps its case here and is lowercased by the model on the way
    to the column, which is why the route test covers that end."""
    assert _sign_up(email="  Mike@Example.COM  ").email == "Mike@example.com"


def test_a_malformed_email_is_rejected() -> None:
    with pytest.raises(ValidationError):
        _sign_up(email="not-an-address")


def test_an_email_over_the_length_bound_is_rejected() -> None:
    """Built well-formed apart from its length — 64 is the longest local part RFC 5321
    allows, so an over-long address has to get there through its domain.

    email-validator enforces the same 254 itself, so this passes with or without the
    max_length on the field. What max_length buys is the bound in the OpenAPI spec, which
    the test below pins.
    """
    local_part = "x" * 64
    domain = ".".join(["y" * 60] * 4) + ".com"
    address = f"{local_part}@{domain}"
    assert len(address) > EMAIL_MAX_LENGTH

    with pytest.raises(ValidationError):
        _sign_up(email=address)


def test_the_bounds_reach_the_json_schema() -> None:
    """The claim the schema's comments make: the sign-up form enforces these without a
    hand-written twin, unlike the date-of-birth bounds Python alone can express."""
    properties = CoachCreate.model_json_schema()["properties"]

    assert properties["email"]["maxLength"] == EMAIL_MAX_LENGTH
    assert properties["password"]["minLength"] == PASSWORD_MIN_LENGTH
    assert properties["password"]["maxLength"] == PASSWORD_MAX_LENGTH
    assert properties["password"]["writeOnly"] is True


@pytest.mark.parametrize("length", [PASSWORD_MIN_LENGTH - 1, PASSWORD_MAX_LENGTH + 1])
def test_a_password_outside_the_bounds_is_rejected(length: int) -> None:
    with pytest.raises(ValidationError):
        _sign_up(password="x" * length)


def test_a_password_keeps_its_whitespace() -> None:
    """Not stripped, unlike the display name and the email: a space is a legitimate
    password character, so stripping would silently alter the credential the coach chose
    and leave them unable to sign in with what they typed."""
    padded = "  spa ced  pw  "

    assert _sign_up(password=padded).password.get_secret_value() == padded


@pytest.mark.parametrize("display_name", ["", "   "])
def test_a_blank_display_name_is_rejected(display_name: str) -> None:
    """ShortText strips before the length check, so whitespace-only is rejected rather
    than stored as a name that renders blank everywhere. Checked here because sign-up is
    its first use on the coach side."""
    with pytest.raises(ValidationError):
        _sign_up(display_name=display_name)


def test_coach_create_has_no_password_hash_field() -> None:
    """The mirror of the CoachRead assertion below: a client must not be able to hand the
    API a hash of its own choosing, so hashing stays the route's job."""
    assert "password_hash" not in CoachCreate.model_fields


def test_the_password_is_not_in_the_repr() -> None:
    """SecretStr's reason for being here. A plain str would put the password into any
    traceback or structured log that renders the model."""
    assert "a-good-password" not in repr(_sign_up())


def test_coach_read_has_no_password_hash_field() -> None:
    assert "password_hash" not in CoachRead.model_fields


def test_reading_a_coach_row_drops_the_password_hash() -> None:
    """The stronger half of the test above: from_attributes pulls values off the ORM
    object, so a hash on the row must not survive the trip through the schema. No
    session needed — the stamps are passed in rather than defaulted by the database,
    which is what keeps this a pure test."""
    stamp = datetime(2026, 8, 11, tzinfo=UTC)
    coach = Coach(
        id=uuid.uuid4(),
        email="mike@example.com",
        display_name="Coach Mike",
        password_hash="not-a-real-hash",
        created_at=stamp,
        updated_at=stamp,
    )

    dumped = CoachRead.model_validate(coach).model_dump()

    assert "password_hash" not in dumped
    assert dumped["email"] == "mike@example.com"
    assert dumped["display_name"] == "Coach Mike"
