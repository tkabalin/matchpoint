import enum
import uuid
from datetime import date, datetime

from sqlalchemy import ARRAY, CheckConstraint, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


# Docstring kept to one line, as the match and point enums are: the note schemas name
# this, which ships the text to the generated TypeScript client.
class NoteFocus(enum.StrEnum):
    """A training focus area a note is filed under."""

    TECHNICAL = "technical"
    MENTAL = "mental"
    PHYSICAL = "physical"
    TACTICAL = "tactical"


# The widest member, "technical". Spelled out rather than measured off the enum, so
# adding a longer member changes the column deliberately in a revision instead of
# silently at import.
FOCUS_LENGTH = 9

_FOCUS_VALUES = ", ".join(f"'{focus.value}'" for focus in NoteFocus)


class PlayerNote(Base):
    """One dated coach note about a player, in the timeline the player screen shows."""

    __tablename__ = "player_notes"
    __table_args__ = (
        # The enum convention's VARCHAR-plus-CHECK, written out because the column is an
        # array: str_enum would constrain the column itself rather than its elements.
        # `<@` is "contained by", so an empty array passes.
        CheckConstraint(
            f"focus_areas <@ ARRAY[{_FOCUS_VALUES}]::varchar[]",
            name="player_note_focus_areas",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The player the note is about, and the only owner the note has: it reaches its
    # coach through the player, the way a match does, so a transfer carries a player's
    # notes to their new coach along with their match history.
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), index=True)
    # Text rather than String(n): a note is prose, and the length bound belongs on the
    # schema, where it reaches the OpenAPI spec and so the client form.
    body: Mapped[str] = mapped_column(Text)
    # The day the note is about, which is not the day it was written: a coach typing up
    # the morning's session that evening, or catching up on a week of them, dates each
    # note to its session. `created_at` still records when the row was written.
    recorded_on: Mapped[date] = mapped_column(Date)
    # Which training focus areas the note is filed under, empty when none were chosen.
    # An array rather than one enum column because a note is commonly two of these at
    # once (a shortening backswing under pressure is technical and mental), and rather
    # than a child table because four values do not need one.
    focus_areas: Mapped[list[str]] = mapped_column(ARRAY(String(FOCUS_LENGTH)), default=list)
    # clock_timestamp(), not now(): now() is the transaction timestamp, so notes written
    # in one transaction would share a value and the created_at tiebreaker below the
    # recorded_on ordering would put them in an arbitrary order.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
