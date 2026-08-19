"""Unit tests for the coach schemas — no fixtures, no database.

CoachCreate is what a sign-up form is written against, so its bounds are pinned at the
figures the schema itself names rather than restated here. CoachUpdate's rule is the
sent/unsent distinction: an omitted field leaves the stored value alone, where an
explicit null is refused. CoachRead's rule is an omission — password_hash must not be
reachable through the schema — which is exactly the kind of thing that survives a
careless edit, because adding the field back looks like completing the model rather
than undoing a decision.
"""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from matchpoint_api.models import Coach, ScoringSystem, Surface
from matchpoint_api.schemas.coach import (
    EMAIL_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    CoachCreate,
    CoachDelete,
    CoachRead,
    CoachUpdate,
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


def test_an_update_omitting_the_display_name_dumps_nothing() -> None:
    """The half of UNSET the route leans on: a field nobody sent has to stay out of
    model_dump(exclude_unset=True), or a PATCH would write the default over a name it
    was never asked to change."""
    assert CoachUpdate.model_validate({}).model_dump(exclude_unset=True) == {}


def test_an_update_carrying_the_display_name_dumps_it_stripped() -> None:
    data = CoachUpdate.model_validate({"display_name": "  Coach Mike  "})

    assert data.model_dump(exclude_unset=True) == {"display_name": "Coach Mike"}


@pytest.mark.parametrize("display_name", ["", "   ", "x" * 101, None])
def test_an_invalid_display_name_is_rejected_on_an_update(display_name: object) -> None:
    """ShortText's bounds hold here exactly as on sign-up, null included: the field is
    optional to send, never optional to hold a value."""
    with pytest.raises(ValidationError):
        CoachUpdate.model_validate({"display_name": display_name})


def test_coach_update_carries_the_name_and_the_preferences_alone() -> None:
    """A field absent from the schema is unreachable through the route that takes it,
    which is what keeps the sign-in email and the password out of a PATCH."""
    assert set(CoachUpdate.model_fields) == {
        "display_name",
        "default_surface",
        "default_scoring_system",
    }


def test_an_update_carrying_a_preference_dumps_it() -> None:
    data = CoachUpdate.model_validate(
        {"default_surface": "clay", "default_scoring_system": "short_sets"}
    )

    assert data.model_dump(exclude_unset=True) == {
        "default_surface": Surface.CLAY,
        "default_scoring_system": ScoringSystem.SHORT_SETS,
    }


@pytest.mark.parametrize("field", ["default_surface", "default_scoring_system"])
def test_an_update_may_clear_a_preference_with_null(field: str) -> None:
    """Unlike display_name above: the columns are nullable, so null is a valid value
    meaning "no preference", not a 422."""
    data = CoachUpdate.model_validate({field: None})

    assert data.model_dump(exclude_unset=True) == {field: None}


@pytest.mark.parametrize(
    ("field", "value"),
    [("default_surface", "sand"), ("default_scoring_system", "best_of_3")],
)
def test_a_preference_outside_its_enum_is_rejected(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        CoachUpdate.model_validate({field: value})


def test_a_closure_carries_the_password_and_the_roster_waiver() -> None:
    """No email and no confirmation field: the session says whose account this is, and a
    typed confirmation would prove the form was filled in rather than who filled it in."""
    assert set(CoachDelete.model_fields) == {"password", "delete_players"}


def test_a_closure_leaves_the_roster_alone_unless_asked() -> None:
    """The default is what makes the refusal the refusal: a body that says nothing about
    the roster must never be the one that clears it."""
    assert CoachDelete.model_validate({"password": "a-good-password"}).delete_players is False


def test_a_closure_takes_the_ceiling_without_the_floor() -> None:
    """`Password`, not `NewPassword`: the floor is sign-up policy for a password being
    chosen, and applying it to one being checked would lock out any coach who enrolled
    before a later raise of it, leaving them unable to close their own account."""
    short = "x" * (PASSWORD_MIN_LENGTH - 1)

    assert CoachDelete.model_validate({"password": short}).password.get_secret_value() == short

    with pytest.raises(ValidationError):
        CoachDelete.model_validate({"password": "x" * (PASSWORD_MAX_LENGTH + 1)})


def test_a_closure_password_is_not_in_the_repr() -> None:
    """SecretStr's reason for being on this body too: a plain str would put the password
    into any traceback or structured log that rendered the model."""
    data = CoachDelete.model_validate({"password": "a-good-password"})

    assert "a-good-password" not in repr(data)


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
