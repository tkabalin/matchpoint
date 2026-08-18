"""Unit tests for the player schemas' validation rules: no fixtures, no database.

The `date_of_birth` bounds, `ShortText` and `LongText` all resolve during model
construction, which makes them the only genuinely pure surface the API has today.
`test_players.py` covers that these rules are wired into the routes; the exhaustive
cases belong here, where they cost a millisecond instead of a round trip.
"""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from matchpoint_api.models import DominantHand, Gender
from matchpoint_api.schemas.player import (
    MAX_AGE_YEARS,
    TRANSFER_CODE_MAX_LENGTH,
    PlayerCreate,
    PlayerUpdate,
    RedeemTransferCodeRequest,
)

NAME_LIMIT = 100
NOTES_LIMIT = 2000


def _player(**overrides: object) -> PlayerCreate:
    """Valid input with the field under test substituted in.

    model_validate rather than the constructor so the enum fields can be handed the
    raw strings a request body carries, and so a required field can be dropped.
    """
    payload: dict[str, object] = {"first_name": "Iga", "last_name": "Swiatek"}
    return PlayerCreate.model_validate(payload | overrides)


def test_only_the_name_parts_are_required() -> None:
    player = _player()

    assert player.date_of_birth is None
    assert player.dominant_hand is None
    assert player.gender is None
    assert player.notes is None


# --- name parts (ShortText) -------------------------------------------------
#
# Both parts carry the same annotation, so the per-field cases below are the ones
# where a mistake could differ between them — a missing field, or one widened to a
# bare `str`. The bound itself is exercised once, on first_name.

NAME_FIELDS = ["first_name", "last_name"]


@pytest.mark.parametrize("field", NAME_FIELDS)
def test_both_name_parts_are_required(field: str) -> None:
    payload = {"first_name": "Iga", "last_name": "Swiatek"}
    del payload[field]

    with pytest.raises(ValidationError):
        PlayerCreate.model_validate(payload)


@pytest.mark.parametrize("field", NAME_FIELDS)
@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_rejects_a_blank_name_part(field: str, value: str) -> None:
    """Empty and whitespace-only both fail, and for the same reason: the strip
    happens before the length check."""
    with pytest.raises(ValidationError):
        _player(**{field: value})


def test_accepts_a_single_character_name() -> None:
    """ShortText's lower bound, which nothing else exercises."""
    assert _player(first_name="A").first_name == "A"


def test_strips_surrounding_whitespace_from_a_name() -> None:
    assert _player(first_name="  Serena  ").first_name == "Serena"


def test_strips_a_name_before_measuring_its_length() -> None:
    """A full-length name that arrives padded is still within the limit. Were the
    order reversed, a trailing space on a long name would be a spurious 422."""
    at_limit = "x" * NAME_LIMIT

    assert _player(first_name=f"  {at_limit}  ").first_name == at_limit


def test_rejects_a_name_over_the_length_limit() -> None:
    with pytest.raises(ValidationError):
        _player(first_name="x" * (NAME_LIMIT + 1))


# --- date_of_birth bounds ---------------------------------------------------


def test_accepts_a_date_of_birth_of_today() -> None:
    """Today is not the future. pydantic's PastDate would reject this."""
    today = date.today()

    assert _player(date_of_birth=today).date_of_birth == today


def test_rejects_a_date_of_birth_of_tomorrow() -> None:
    with pytest.raises(ValidationError):
        _player(date_of_birth=date.today() + timedelta(days=1))


def test_accepts_a_date_of_birth_just_inside_the_age_limit() -> None:
    """Pins MAX_AGE_YEARS from the inside — the route tests use dates nowhere
    near the edge, so a bound that drifted would still pass them."""
    just_inside = date.today() - timedelta(days=365.25 * MAX_AGE_YEARS - 1)

    assert _player(date_of_birth=just_inside).date_of_birth == just_inside


def test_rejects_a_date_of_birth_just_outside_the_age_limit() -> None:
    just_outside = date.today() - timedelta(days=365.25 * MAX_AGE_YEARS + 1)

    with pytest.raises(ValidationError):
        _player(date_of_birth=just_outside)


# --- dominant_hand and gender ------------------------------------------------


def test_coerces_a_dominant_hand_string_to_the_enum() -> None:
    assert _player(dominant_hand="left").dominant_hand is DominantHand.LEFT


def test_rejects_a_dominant_hand_outside_the_enum() -> None:
    with pytest.raises(ValidationError):
        _player(dominant_hand="both")


def test_coerces_a_gender_string_to_the_enum() -> None:
    assert _player(gender="other").gender is Gender.OTHER


def test_rejects_a_gender_outside_the_enum() -> None:
    with pytest.raises(ValidationError):
        _player(gender="unspecified")


# --- notes (LongText) --------------------------------------------------------


def test_accepts_notes_at_the_length_limit() -> None:
    at_limit = "x" * NOTES_LIMIT

    assert _player(notes=at_limit).notes == at_limit


def test_rejects_notes_over_the_length_limit() -> None:
    with pytest.raises(ValidationError):
        _player(notes="x" * (NOTES_LIMIT + 1))


def test_strips_surrounding_whitespace_from_notes() -> None:
    assert _player(notes="  Wide forehand.  ").notes == "Wide forehand."


@pytest.mark.parametrize("value", ["", "   "])
def test_rejects_blank_notes(value: str) -> None:
    """An optional field, but "" is not how you say "no notes" — null is. Storing
    blank would leave the dashboard rendering an empty notes panel as though the
    coach had written something."""
    with pytest.raises(ValidationError):
        _player(notes=value)


def test_accepts_an_explicit_null_for_notes() -> None:
    assert _player(notes=None).notes is None


# --- PlayerUpdate ------------------------------------------------------------
#
# The field annotations are PlayerCreate's, so the cases here are the ones the two
# schemas differ on: what a dump carries, and what null does per field.


def test_an_empty_update_carries_no_fields() -> None:
    """What makes the empty PATCH a no-op: exclude_unset leaves the route nothing to
    apply, rather than handing it every field's default."""
    assert PlayerUpdate.model_validate({}).model_dump(exclude_unset=True) == {}


def test_an_update_carries_only_the_fields_sent() -> None:
    update = PlayerUpdate.model_validate({"first_name": "Iga"})

    assert update.model_dump(exclude_unset=True) == {"first_name": "Iga"}


def test_an_update_distinguishes_an_absent_field_from_a_null_one() -> None:
    """The distinction the whole schema shape exists for: null reaches the route as a
    value to store, where an omitted field never appears."""
    update = PlayerUpdate.model_validate({"date_of_birth": None})

    assert update.model_dump(exclude_unset=True) == {"date_of_birth": None}


@pytest.mark.parametrize("field", NAME_FIELDS)
def test_an_update_rejects_a_null_name_part(field: str) -> None:
    """Both columns are NOT NULL, so the UNSET default has to leave the annotation
    non-optional: null is a 422 here rather than an IntegrityError later."""
    with pytest.raises(ValidationError):
        PlayerUpdate.model_validate({field: None})


@pytest.mark.parametrize("field", ["date_of_birth", "dominant_hand", "gender", "notes"])
def test_an_update_accepts_a_null_for_every_nullable_field(field: str) -> None:
    """The mirror of the test above, so a field cannot quietly move between the two
    groups: everything over a nullable column takes null as "clear it"."""
    assert PlayerUpdate.model_validate({field: None}).model_dump(exclude_unset=True) == {
        field: None
    }


def test_an_update_applies_the_name_bounds() -> None:
    with pytest.raises(ValidationError):
        PlayerUpdate.model_validate({"first_name": "x" * (NAME_LIMIT + 1)})


def test_an_update_rejects_a_date_of_birth_of_tomorrow() -> None:
    """The bounds are one shared annotation, so an update cannot drift from a create."""
    with pytest.raises(ValidationError):
        PlayerUpdate.model_validate({"date_of_birth": date.today() + timedelta(days=1)})


def test_an_update_rejects_a_date_of_birth_outside_the_age_limit() -> None:
    just_outside = date.today() - timedelta(days=365.25 * MAX_AGE_YEARS + 1)

    with pytest.raises(ValidationError):
        PlayerUpdate.model_validate({"date_of_birth": just_outside})


def test_an_update_accepts_a_date_of_birth_inside_the_bounds() -> None:
    today = date.today()

    assert PlayerUpdate.model_validate({"date_of_birth": today}).date_of_birth == today


def test_a_transfer_code_is_bounded() -> None:
    """The bound keeps an unbounded string away from the hash; it reaches the spec, so
    the redeem form knows the ceiling without a hand-written twin."""
    with pytest.raises(ValidationError):
        RedeemTransferCodeRequest.model_validate({"code": "x" * (TRANSFER_CODE_MAX_LENGTH + 1)})


def test_a_transfer_code_is_a_secret() -> None:
    """SecretStr, so errors.py keeps a rejected body from echoing the code back: the
    value is a live capability to take a player, not a throwaway."""
    request = RedeemTransferCodeRequest.model_validate({"code": "a-transfer-code"})

    assert "a-transfer-code" not in repr(request)
    assert request.code.get_secret_value() == "a-transfer-code"
