import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class DeletedMatch(Base):
    """The id of a deleted match, remembered long enough that a queued create cannot undo it.

    A match is created on a device and its create retried until the server acknowledges
    it, so a delete leaving no trace could be reversed by a flush from a device that was
    offline for it (#214). `routers/matches.py` holds how long one of these is honoured.
    """

    __tablename__ = "deleted_matches"

    # The deleted match's own id: no foreign key, since the row it names is gone. Nothing
    # else of the match is kept, which is why this is not the deleted-but-kept row the
    # schema refuses everywhere else.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    # The coach who deleted it, kept only so `DELETE /coaches/me` can find and remove
    # this row; the 410 checks in `routers/matches.py` never read it, and stay
    # coach-agnostic.
    coach_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("coaches.id"), index=True)
    # The one timestamp, in place of the created_at and updated_at every other table
    # carries: the row is written when the match is deleted and only ever refreshed by a
    # later delete of the same id, so either of those columns would repeat this one.
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
