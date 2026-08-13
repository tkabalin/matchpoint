"""Unit tests for the MatchCreate and MatchUpdate validation rules — no fixtures, no
database.

Everything the two schemas do resolves during model construction, so the exhaustive
cases belong here, where they cost a millisecond instead of a round trip.
`tests/routers/test_matches.py` covers that the rules are wired into the routes.
"""

from datetime import date, timedelta
from typing import Any

import pytest
from pydantic import ValidationError

from matchpoint_api.models import SetsFormat, Surface
from matchpoint_api.schemas.match import MAX_PAST_YEARS, MatchCreate, MatchUpdate

PLAYER_ID = "3f8c1a2e-0b4d-4c7e-9a51-2d6f8b0e4c13"
REQUIRED: dict[str, Any] = {"player_id": PLAYER_ID, "played_on": "2026-08-01"}

# The two free-text fields carry the same ShortText annotation, and each one is a
# separate declaration that could lose it — so the boundaries are checked on both.
TEXT_FIELDS = ["opponent_name", "event"]


def _match(**overrides: Any) -> MatchCreate:
    return MatchCreate.model_validate(REQUIRED | overrides)


def test_only_the_player_and_date_are_required() -> None:
    match = _match()

    assert match.played_on == date(2026, 8, 1)
    assert match.opponent_name is None
    assert match.surface is None
    assert match.event is None
    assert match.sets_format is None


# --- player_id --------------------------------------------------------------


def test_coerces_a_player_id_string_to_a_uuid() -> None:
    """The client sends JSON, so the id arrives as a string on every request."""
    assert str(_match().player_id) == PLAYER_ID


def test_rejects_a_malformed_player_id() -> None:
    with pytest.raises(ValidationError):
        _match(player_id="not-a-uuid")


def test_rejects_a_missing_player_id() -> None:
    with pytest.raises(ValidationError):
        MatchCreate.model_validate({"played_on": "2026-08-01"})


# --- played_on --------------------------------------------------------------


def test_rejects_a_missing_played_on() -> None:
    """The one field with no sensible default: a match without a date is invisible to
    every trend the dashboard draws."""
    with pytest.raises(ValidationError):
        MatchCreate.model_validate({"player_id": PLAYER_ID})


@pytest.mark.parametrize("played_on", ["01-08-2026", "2026-02-30", "yesterday", ""])
def test_rejects_a_played_on_that_is_not_an_iso_date(played_on: str) -> None:
    """Day-first and impossible dates included: both are what a hand-typed date
    actually looks like when it goes wrong."""
    with pytest.raises(ValidationError):
        _match(played_on=played_on)


def test_accepts_a_played_on_of_today() -> None:
    """Today is the case the capture flow actually produces, so the future bound has to
    stop just short of it."""
    today = date.today()

    assert _match(played_on=today).played_on == today


def test_rejects_a_played_on_of_tomorrow() -> None:
    with pytest.raises(ValidationError):
        _match(played_on=date.today() + timedelta(days=1))


def test_accepts_a_played_on_just_inside_the_age_limit() -> None:
    """Pins MAX_PAST_YEARS from the inside — the route tests use dates nowhere near the
    edge, so a bound that drifted would still pass them."""
    just_inside = date.today() - timedelta(days=365.25 * MAX_PAST_YEARS - 1)

    assert _match(played_on=just_inside).played_on == just_inside


def test_rejects_a_played_on_just_outside_the_age_limit() -> None:
    just_outside = date.today() - timedelta(days=365.25 * MAX_PAST_YEARS + 1)

    with pytest.raises(ValidationError):
        _match(played_on=just_outside)


# --- surface and sets_format -----------------------------------------------------


def test_coerces_a_surface_string_to_the_enum() -> None:
    assert _match(surface="clay").surface is Surface.CLAY


def test_rejects_a_surface_outside_the_enum() -> None:
    with pytest.raises(ValidationError):
        _match(surface="sand")


def test_coerces_a_sets_format_string_to_the_enum() -> None:
    assert _match(sets_format="best_of_3").sets_format is SetsFormat.BEST_OF_3


def test_rejects_a_sets_format_outside_the_enum() -> None:
    with pytest.raises(ValidationError):
        _match(sets_format="best_of_2")


# --- opponent_name and event (ShortText) ------------------------------------


@pytest.mark.parametrize("field", TEXT_FIELDS)
def test_accepts_an_omitted_or_null_text_field(field: str) -> None:
    """Both fields are optional because the coach is setting a match up courtside —
    an unnamed opponent must not block the rest of the record."""
    assert getattr(_match(**{field: None}), field) is None


@pytest.mark.parametrize("field", TEXT_FIELDS)
@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_rejects_a_blank_text_field(field: str, value: str) -> None:
    """Empty and whitespace-only both fail, and for the same reason: the strip happens
    before the length check. A blank opponent renders the same as a missing one, so it
    is rejected rather than stored."""
    with pytest.raises(ValidationError):
        _match(**{field: value})


@pytest.mark.parametrize("field", TEXT_FIELDS)
def test_accepts_a_single_character_text_field(field: str) -> None:
    """ShortText's lower bound, which nothing else exercises."""
    assert getattr(_match(**{field: "A"}), field) == "A"


@pytest.mark.parametrize("field", TEXT_FIELDS)
def test_strips_surrounding_whitespace_from_a_text_field(field: str) -> None:
    assert getattr(_match(**{field: "  Aryna  "}), field) == "Aryna"


@pytest.mark.parametrize("field", TEXT_FIELDS)
def test_strips_a_text_field_before_measuring_its_length(field: str) -> None:
    """A full-length value that arrives padded is still within the limit. Were the
    order reversed, a trailing space on a long name would be a spurious 422."""
    at_limit = "x" * 100

    assert getattr(_match(**{field: f"  {at_limit}  "}), field) == at_limit


@pytest.mark.parametrize("field", TEXT_FIELDS)
def test_rejects_a_text_field_over_the_length_limit(field: str) -> None:
    with pytest.raises(ValidationError):
        _match(**{field: "x" * 101})


# --- MatchUpdate -------------------------------------------------------------
#
# The field annotations are MatchCreate's, so the cases here are the ones the two
# schemas differ on: what a dump carries, what null does per field, and player_id.


def test_an_empty_update_carries_no_fields() -> None:
    """What makes the empty PATCH a no-op: exclude_unset leaves the route nothing to
    apply, rather than handing it every field's default."""
    assert MatchUpdate.model_validate({}).model_dump(exclude_unset=True) == {}


def test_an_update_carries_only_the_fields_sent() -> None:
    update = MatchUpdate.model_validate({"event": "Wimbledon"})

    assert update.model_dump(exclude_unset=True) == {"event": "Wimbledon"}


def test_an_update_drops_a_player_id() -> None:
    """player_id is immutable by omission, so it dumps to nothing at all: the route's
    loop never sees a field it could use to move the match."""
    assert MatchUpdate.model_validate({"player_id": PLAYER_ID}).model_dump(exclude_unset=True) == {}


def test_an_update_rejects_a_null_played_on() -> None:
    """The column is NOT NULL, so the UNSET default has to leave the annotation
    non-optional: null is a 422 here rather than an IntegrityError later."""
    with pytest.raises(ValidationError):
        MatchUpdate.model_validate({"played_on": None})


@pytest.mark.parametrize("field", ["opponent_name", "surface", "event", "sets_format"])
def test_an_update_accepts_a_null_for_every_nullable_field(field: str) -> None:
    """The mirror of the test above, so a field cannot quietly move between the two
    groups: everything over a nullable column takes null as "clear it"."""
    assert MatchUpdate.model_validate({field: None}).model_dump(exclude_unset=True) == {field: None}


def test_an_update_applies_the_text_bounds() -> None:
    with pytest.raises(ValidationError):
        MatchUpdate.model_validate({"opponent_name": "x" * 101})


def test_an_update_rejects_a_played_on_of_tomorrow() -> None:
    """The bounds are one shared annotation, so an update cannot drift from a create."""
    with pytest.raises(ValidationError):
        MatchUpdate.model_validate({"played_on": date.today() + timedelta(days=1)})


def test_an_update_rejects_a_played_on_outside_the_past_limit() -> None:
    just_outside = date.today() - timedelta(days=365.25 * MAX_PAST_YEARS + 1)

    with pytest.raises(ValidationError):
        MatchUpdate.model_validate({"played_on": just_outside})


def test_an_update_accepts_a_played_on_inside_the_bounds() -> None:
    today = date.today()

    assert MatchUpdate.model_validate({"played_on": today}).played_on == today
