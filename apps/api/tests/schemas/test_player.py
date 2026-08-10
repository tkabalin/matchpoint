"""Unit tests for the PlayerCreate validation rules — no fixtures, no database.

The `date_of_birth` bounds, `ShortText` and `LongText` all resolve during model
construction, which makes them the only genuinely pure surface the API has today.
`test_players.py` covers that these rules are wired into the route; the exhaustive
cases belong here, where they cost a millisecond instead of a round trip.
"""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from matchpoint_api.models import DominantHand, Gender
from matchpoint_api.schemas.player import MAX_AGE_YEARS, PlayerCreate

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
