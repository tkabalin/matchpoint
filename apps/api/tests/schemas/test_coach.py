"""Unit tests for CoachRead — no fixtures, no database.

There is no CoachCreate to validate yet (#22), so the only rule here is an omission:
password_hash must not be reachable through the schema. An omission is exactly the kind
of thing that survives a careless edit, because adding the field back looks like
completing the model rather than undoing a decision.
"""

import uuid
from datetime import UTC, datetime

from matchpoint_api.models import Coach
from matchpoint_api.schemas.coach import CoachRead


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
