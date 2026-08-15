import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import Coach, SetsFormat, Surface
from tests.factories import make_coach

EMAIL_LIMIT = 254
DISPLAY_NAME_LIMIT = 100
NOT_NULL_COLUMNS = ["email", "display_name", "password_hash"]


def test_coach_round_trips(db_session: Session) -> None:
    coach = make_coach(
        db_session,
        email="mike@example.com",
        display_name="Coach Mike",
        password_hash="not-a-real-hash",
    )
    db_session.commit()

    saved = db_session.get(Coach, coach.id)
    assert saved is not None
    assert saved.email == "mike@example.com"
    assert saved.display_name == "Coach Mike"
    assert saved.password_hash == "not-a-real-hash"
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_created_at_differs_between_rows_in_one_transaction(db_session: Session) -> None:
    """created_at defaults to clock_timestamp(), not now().

    Both commits below are savepoint releases inside the fixture's single outer
    transaction, so under now() — the transaction timestamp — the two rows would claim
    the same creation time.
    """
    first = make_coach(db_session)
    db_session.commit()

    second = make_coach(db_session)
    db_session.commit()

    assert second.created_at > first.created_at


def test_updated_at_advances_when_a_row_changes(db_session: Session) -> None:
    """Through the ORM, not raw SQL: onupdate is emitted by SQLAlchemy on an UPDATE
    rather than enforced by a trigger, so a raw UPDATE would never fire it."""
    coach = make_coach(db_session)
    db_session.commit()
    first_written = coach.updated_at

    coach.display_name = "Michael Ndlovu"
    db_session.commit()

    assert coach.updated_at > first_written


# The nullability, the unique email and the column widths are deliberate choices argued
# in the model. Line coverage can't tell whether they still hold — the class body
# executes on import either way — so they are pinned here, against writes that never
# pass through Pydantic or the ORM.


def _insert_raw_coach(session: Session, **columns: object) -> None:
    """Insert a coach through raw SQL, bypassing Pydantic and the ORM.

    The constraints below are the database's job precisely because they are what stands
    between a bad write and an account nobody can sign in to. Nullable columns the
    caller doesn't name are written as NULL.
    """
    session.execute(
        text(
            "INSERT INTO coaches "
            "(id, email, display_name, password_hash, default_surface, default_sets_format) "
            "VALUES (:id, :email, :display_name, :password_hash, "
            ":default_surface, :default_sets_format)"
        ),
        {
            "id": uuid.uuid4(),
            "email": "mike@example.com",
            "display_name": "Coach Mike",
            "password_hash": "not-a-real-hash",
            "default_surface": None,
            "default_sets_format": None,
            **columns,
        },
    )


@pytest.mark.parametrize("column", NOT_NULL_COLUMNS)
def test_database_requires_every_column(db_session: Session, column: str) -> None:
    """All three are collected at sign-up, and an account missing any of them is one
    nobody can sign in to. The NOT NULL comes from the model's bare `Mapped[str]`, so an
    accidental `| None` would widen it silently."""
    with pytest.raises(IntegrityError):
        _insert_raw_coach(db_session, **{column: None})


def test_database_rejects_a_duplicate_email(db_session: Session) -> None:
    """Email is the sign-in identity, so two accounts sharing one is not a duplicate
    row but an ambiguous login."""
    _insert_raw_coach(db_session)

    with pytest.raises(IntegrityError):
        _insert_raw_coach(db_session)


def test_database_rejects_an_email_that_is_not_lowercased(db_session: Session) -> None:
    """The UNIQUE constraint compares case-sensitively, so the CHECK is what keeps
    Mike@ and mike@ from being two accounts with two separate rosters."""
    with pytest.raises(IntegrityError):
        _insert_raw_coach(db_session, email="Mike@example.com")


def test_the_orm_lowercases_an_email_on_the_way_in(db_session: Session) -> None:
    """So an address typed with capitals is stored, and later found, as one address —
    rather than tripping the CHECK above at whatever endpoint happened to write it."""
    coach = make_coach(db_session, email="Mike@Example.COM")
    db_session.commit()

    saved = db_session.get(Coach, coach.id)
    assert saved is not None
    assert saved.email == "mike@example.com"


def test_database_rejects_an_email_over_the_column_width(db_session: Session) -> None:
    """254 characters is the longest address SMTP will carry, and the bound CoachCreate's
    EMAIL_MAX_LENGTH is written against. Pinned separately from the schema's figure on
    purpose: if the two ever diverge, an address the schema accepts becomes a 500."""
    local_part = "x" * (EMAIL_LIMIT + 1 - len("@example.com"))

    with pytest.raises(DataError):
        _insert_raw_coach(db_session, email=f"{local_part}@example.com")


def test_database_rejects_a_display_name_over_the_column_width(db_session: Session) -> None:
    """String(100), matching the name columns on Player — which is why CoachCreate's
    display_name is ShortText, and why narrowing this column would break that pairing."""
    with pytest.raises(DataError):
        _insert_raw_coach(db_session, display_name="x" * (DISPLAY_NAME_LIMIT + 1))


def test_database_rejects_default_surface_outside_the_enum(db_session: Session) -> None:
    """Four characters on purpose, as on the matches table's surface column: VARCHAR(6),
    sized to "carpet", so a longer bogus value would fail on length before the CHECK."""
    with pytest.raises(IntegrityError):
        _insert_raw_coach(db_session, default_surface="sand")


def test_database_rejects_default_sets_format_outside_the_enum(db_session: Session) -> None:
    """A "best_of_2" is exactly the column's VARCHAR(9), so it reaches the CHECK."""
    with pytest.raises(IntegrityError):
        _insert_raw_coach(db_session, default_sets_format="best_of_2")


@pytest.mark.parametrize(
    ("column", "member"),
    [("default_surface", m.value) for m in Surface]
    + [("default_sets_format", m.value) for m in SetsFormat],
)
def test_database_accepts_every_member_of_the_reused_enums(
    db_session: Session, column: str, member: str
) -> None:
    """The mirror of the two tests above, and the only guard on the reuse: these enums
    back a CHECK on matches as well, and Alembic compares a CHECK by name and never by
    condition, so a member migrated on one table alone fails nothing but this."""
    _insert_raw_coach(db_session, **{column: member})


def test_database_accepts_a_coach_with_no_preferences(db_session: Session) -> None:
    """Both preference columns are nullable on purpose — null is "no preference held",
    the state every pre-existing coach row is in after the migration."""
    _insert_raw_coach(db_session)

    stored = db_session.execute(
        text("SELECT default_surface, default_sets_format FROM coaches")
    ).one()
    assert stored == (None, None)


def test_database_accepts_a_password_hash_of_any_length(db_session: Session) -> None:
    """password_hash is unbounded Text on purpose: hash length is the algorithm's
    business, and a width bound would have to be migrated to change algorithm."""
    _insert_raw_coach(db_session, password_hash="x" * 1000)

    stored = db_session.scalar(text("SELECT length(password_hash) FROM coaches"))
    assert stored == 1000
