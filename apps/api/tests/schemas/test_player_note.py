"""Unit tests for the PlayerNoteCreate and PlayerNoteUpdate validation rules: no
fixtures, no database.

Everything the two schemas do resolves during model construction, so the exhaustive
cases belong here, where they cost a millisecond instead of a round trip.
`tests/routers/test_players.py` covers that the rules are wired into the routes.
"""

from datetime import date, timedelta
from typing import Any

import pytest
from pydantic import ValidationError

from matchpoint_api.models import NoteFocus
from matchpoint_api.schemas.player_note import (
    MAX_PAST_YEARS,
    PlayerNoteCreate,
    PlayerNoteUpdate,
)

BODY_LIMIT = 2000
REQUIRED: dict[str, Any] = {"body": "Rushed between points.", "recorded_on": "2026-08-01"}


def _note(**overrides: Any) -> PlayerNoteCreate:
    return PlayerNoteCreate.model_validate(REQUIRED | overrides)


def test_only_the_body_and_the_date_are_required() -> None:
    note = _note()

    assert note.body == "Rushed between points."
    assert note.recorded_on == date(2026, 8, 1)
    assert note.focus_areas == []


@pytest.mark.parametrize("field", ["body", "recorded_on"])
def test_rejects_a_missing_required_field(field: str) -> None:
    with pytest.raises(ValidationError):
        PlayerNoteCreate.model_validate({key: REQUIRED[key] for key in REQUIRED if key != field})


def test_rejects_a_key_the_schema_does_not_carry() -> None:
    """extra="forbid" from RequestModel: player_id comes from the path, so a body
    naming one is a caller bug rather than a field to ignore."""
    with pytest.raises(ValidationError):
        _note(player_id="3f8c1a2e-0b4d-4c7e-9a51-2d6f8b0e4c13")


# --- body -------------------------------------------------------------------


def test_strips_surrounding_whitespace_from_the_body() -> None:
    assert _note(body="  Toss drifted left.  ").body == "Toss drifted left."


def test_rejects_a_whitespace_only_body() -> None:
    """A note that renders blank everywhere is not a note, so it is refused rather
    than stored."""
    with pytest.raises(ValidationError):
        _note(body="   ")


def test_accepts_a_body_at_the_length_limit() -> None:
    assert len(_note(body="n" * BODY_LIMIT).body) == BODY_LIMIT


def test_rejects_an_overlong_body() -> None:
    with pytest.raises(ValidationError):
        _note(body="n" * (BODY_LIMIT + 1))


# --- recorded_on ------------------------------------------------------------


def test_accepts_a_note_dated_today() -> None:
    """The common case, and the one a bound written as "strictly past" would refuse."""
    assert _note(recorded_on=date.today().isoformat()).recorded_on == date.today()


def test_rejects_a_note_dated_in_the_future() -> None:
    """A note records a session that has already happened."""
    with pytest.raises(ValidationError):
        _note(recorded_on=(date.today() + timedelta(days=1)).isoformat())


def test_accepts_a_note_about_a_session_seasons_ago() -> None:
    """Back-filling history is exactly what a date distinct from created_at is for."""
    old = date.today() - timedelta(days=365 * (MAX_PAST_YEARS - 1))
    assert _note(recorded_on=old.isoformat()).recorded_on == old


def test_rejects_an_implausibly_old_note_date() -> None:
    """The floor catches a wrong century, not last Tuesday typed for this one."""
    with pytest.raises(ValidationError):
        _note(recorded_on=(date.today() - timedelta(days=365 * (MAX_PAST_YEARS + 2))).isoformat())


# --- focus_areas ------------------------------------------------------------


def test_keeps_focus_areas_in_declaration_order() -> None:
    """Canonical order, whatever order the coach tapped them in, so two notes filed the
    same way compare equal."""
    note = _note(focus_areas=["tactical", "mental", "technical"])

    assert note.focus_areas == [NoteFocus.TECHNICAL, NoteFocus.MENTAL, NoteFocus.TACTICAL]


def test_files_a_note_under_each_area_once() -> None:
    assert _note(focus_areas=["mental", "mental"]).focus_areas == [NoteFocus.MENTAL]


def test_rejects_a_focus_area_outside_the_four() -> None:
    with pytest.raises(ValidationError):
        _note(focus_areas=["nutritional"])


def test_rejects_a_null_focus_areas_list() -> None:
    """The column is NOT NULL: empty is how "filed under nothing" is said."""
    with pytest.raises(ValidationError):
        _note(focus_areas=None)


# --- the update schema ------------------------------------------------------


def test_an_update_may_carry_nothing() -> None:
    """Every field optional, so a PATCH sends only what changed; apply_to leaves an
    absent field alone."""
    assert PlayerNoteUpdate().model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize(
    ("field", "value"),
    [("body", "Reworked."), ("recorded_on", "2026-08-02"), ("focus_areas", ["physical"])],
)
def test_an_update_carries_each_mutable_field(field: str, value: Any) -> None:
    assert field in PlayerNoteUpdate.model_validate({field: value}).model_dump(exclude_unset=True)


def test_an_update_clears_the_focus_areas_with_an_empty_list() -> None:
    """The way a coach unfiles a note: an empty list, never a null."""
    assert PlayerNoteUpdate(focus_areas=[]).model_dump(exclude_unset=True) == {"focus_areas": []}


@pytest.mark.parametrize("field", ["body", "recorded_on", "focus_areas"])
def test_an_update_rejects_a_null_over_a_non_nullable_column(field: str) -> None:
    """Each of these columns is NOT NULL, so null is a 422 from pydantic rather than an
    IntegrityError from the flush."""
    with pytest.raises(ValidationError):
        PlayerNoteUpdate.model_validate({field: None})


def test_an_update_applies_the_same_bounds_as_a_create() -> None:
    """The shared annotations are what stop the two schemas drifting apart."""
    with pytest.raises(ValidationError):
        PlayerNoteUpdate.model_validate({"recorded_on": (date.today() + timedelta(1)).isoformat()})
    with pytest.raises(ValidationError):
        PlayerNoteUpdate.model_validate({"body": "  "})
