import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import NoteFocus, Player, PlayerNote
from matchpoint_api.models.player_note import FOCUS_LENGTH
from tests.factories import make_player, make_player_note

NOT_NULL_COLUMNS = ["player_id", "body", "recorded_on", "focus_areas"]


def test_player_note_round_trips(db_session: Session) -> None:
    player = make_player(db_session)
    note = PlayerNote(
        player_id=player.id,
        body="Toss drifted left on the second serve all session.",
        recorded_on=date(2026, 8, 15),
        focus_areas=[NoteFocus.TECHNICAL, NoteFocus.MENTAL],
    )
    db_session.add(note)
    db_session.commit()

    saved = db_session.get(PlayerNote, note.id)
    assert saved is not None
    assert saved.player_id == player.id
    assert saved.body == "Toss drifted left on the second serve all session."
    assert saved.recorded_on == date(2026, 8, 15)
    assert saved.focus_areas == ["technical", "mental"]
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_a_note_filed_under_nothing_stores_an_empty_list(db_session: Session) -> None:
    """Empty is how "no focus area" is said, so the column never has to mean it with a
    null as well: the quick-note path writes a body and nothing else."""
    note = make_player_note(db_session)
    db_session.commit()

    saved = db_session.get(PlayerNote, note.id)
    assert saved is not None
    assert saved.focus_areas == []


def test_the_note_date_is_independent_of_when_the_row_was_written(db_session: Session) -> None:
    """The reason recorded_on exists: a coach writing up last week's session dates the
    note to the session, and created_at still records the write."""
    note = make_player_note(db_session, recorded_on=date(2026, 1, 5))
    db_session.commit()

    saved = db_session.get(PlayerNote, note.id)
    assert saved is not None
    assert saved.recorded_on == date(2026, 1, 5)
    assert saved.created_at.date() != date(2026, 1, 5)


def test_deleting_a_player_with_notes_is_refused(db_session: Session) -> None:
    """No ondelete here either, so `DELETE /players/{id}` naming this table is what
    takes the notes out; a route that forgot would stop rather than orphan them."""
    note = make_player_note(db_session)
    player = db_session.get(Player, note.player_id)
    assert player is not None

    db_session.delete(player)
    with pytest.raises(IntegrityError):
        db_session.flush()


# The constraints below are pinned against writes that never pass through the ORM,
# because the database is what holds each line.


def _insert_raw_note(session: Session, **columns: object) -> None:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "player_id": make_player(session).id,
        "body": "Rushed between points on break points.",
        "recorded_on": date(2026, 8, 1),
        "focus_areas": [NoteFocus.MENTAL.value],
    }
    session.execute(
        text(
            "INSERT INTO player_notes (id, player_id, body, recorded_on, focus_areas) "
            "VALUES (:id, :player_id, :body, :recorded_on, :focus_areas)"
        ),
        defaults | columns,
    )


@pytest.mark.parametrize("column", NOT_NULL_COLUMNS)
def test_database_requires_every_column(db_session: Session, column: str) -> None:
    """A note with no body says nothing, one with no player is about nobody, and a null
    focus_areas would be a second way to say the empty list already says."""
    with pytest.raises(IntegrityError):
        _insert_raw_note(db_session, **{column: None})


def test_database_refuses_a_note_for_a_player_that_does_not_exist(db_session: Session) -> None:
    """The foreign key is what lets every read scope a note by joining to its player."""
    with pytest.raises(IntegrityError):
        _insert_raw_note(db_session, player_id=uuid.uuid4())


def test_database_refuses_a_focus_area_outside_the_four(db_session: Session) -> None:
    """The CHECK is the enum convention applied to an array: the members are constrained
    in the database, not only by the schema in front of it. The value is nine characters
    so the column's own width refuses nothing, leaving the CHECK to answer."""
    with pytest.raises(IntegrityError):
        _insert_raw_note(db_session, focus_areas=["nutrition"])


def test_database_accepts_no_focus_areas_at_all(db_session: Session) -> None:
    """`<@` reads as "contained by", which an empty array satisfies. Worth pinning,
    since a CHECK written as membership per element would refuse it instead."""
    _insert_raw_note(db_session, focus_areas=[])

    stored = db_session.scalars(text("SELECT focus_areas FROM player_notes")).all()
    assert list(stored) == [[]]


def test_database_bounds_a_focus_area_at_the_widest_member(db_session: Session) -> None:
    """The column is sized to "technical" exactly, so a longer value is a bug rather
    than a value to store: a new member wider than this needs its own revision."""
    with pytest.raises(DataError):
        _insert_raw_note(db_session, focus_areas=["x" * (FOCUS_LENGTH + 1)])
