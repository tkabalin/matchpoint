"""Deriving a match's set scores from the points and score checkpoints captured against it.

`match_sets` rows are a cache of a fold over `points` and `score_checkpoints`, never
anything a client sends (docs/data-model.md). Recomputing the whole match rather than
folding in a batch is what makes a late, partial or retried flush land on the same
answer, whichever endpoint it arrived through and in whatever order.
"""

import uuid
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from matchpoint_api.models import MatchSet, MatchSide, Point, ScoreCheckpoint
from matchpoint_api.schemas.score_checkpoint import ScoreSnapshot

# The columns a recompute owns. `winner` is included, and nulls back to None when the
# point that closed a set has yet to arrive.
_DERIVED = ("games_won_tracked", "games_won_opponent", "winner")


def recompute_match_sets(db: Session, match_id: uuid.UUID) -> list[MatchSet]:
    """Rewrite one match's set rows from its events, and return them in set order.

    The newest checkpoint is the base: the board as the coach last declared it. The
    points after it add to that base, except in a set it declared won, so a mis-stamped
    or second-device point cannot reopen a set the coach has closed. With no checkpoint
    the base is empty and every point counts. The tail is aggregated in Postgres, the
    shape every analytics query over these points will be, and folded onto the board in
    Python, a board being a handful of entries. The caller owns the commit.
    """
    checkpoint = db.execute(
        select(ScoreCheckpoint.sequence, ScoreCheckpoint.after)
        .where(ScoreCheckpoint.match_id == match_id)
        .order_by(ScoreCheckpoint.sequence.desc())
        .limit(1)
    ).first()
    merged: dict[int, dict[str, Any]] = {}
    tail = (
        select(
            Point.set_number,
            func.count().filter(Point.is_game_end, Point.won).label("games_won_tracked"),
            func.count().filter(Point.is_game_end, ~Point.won).label("games_won_opponent"),
            # The set's closing point says who took it, and nothing does while the set
            # is still in flight.
            func.bool_or(Point.won).filter(Point.is_set_end).label("set_won"),
        )
        .where(Point.match_id == match_id)
        .group_by(Point.set_number)
    )
    if checkpoint is not None:
        # Read back through the schema that vetted it, rather than by bare key.
        for entry in ScoreSnapshot.model_validate(checkpoint.after).sets:
            merged[entry.set_number] = {
                "games_won_tracked": entry.games_tracked,
                "games_won_opponent": entry.games_opponent,
                "winner": entry.winner,
            }
        closed = [number for number, tally in merged.items() if tally["winner"] is not None]
        # Points and checkpoints share one sequence space, and a checkpoint sorts after
        # a point at a tie (which a correct client never produces), so strictly greater.
        tail = tail.where(Point.sequence > checkpoint.sequence, Point.set_number.not_in(closed))

    for row in db.execute(tail):
        current = merged.setdefault(
            row.set_number,
            {"games_won_tracked": 0, "games_won_opponent": 0, "winner": None},
        )
        current["games_won_tracked"] += row.games_won_tracked
        current["games_won_opponent"] += row.games_won_opponent
        # A set the tail reaches is one the board left open, so its closing point, once
        # it has arrived, is what names the winner.
        current["winner"] = _winner(row.set_won)

    sets: list[MatchSet] = []
    if merged:
        statement = insert(MatchSet).values(
            [
                {"match_id": match_id, "set_number": number, **tally}
                for number, tally in merged.items()
            ]
        )
        statement = statement.on_conflict_do_update(
            index_elements=[MatchSet.match_id, MatchSet.set_number],
            set_={
                **{name: statement.excluded[name] for name in _DERIVED},
                # By hand because ON CONFLICT is an INSERT to SQLAlchemy, so the
                # column's onupdate never fires, as at create_player_transfer_code.
                "updated_at": func.clock_timestamp(),
            },
        )
        # populate_existing so a row this session already holds comes back with what
        # was just written, rather than the tally it was loaded with.
        sets = list(
            db.scalars(statement.returning(MatchSet).execution_options(populate_existing=True))
        )

    # An upsert can only add or overwrite, so a recompute that derives fewer sets than
    # the last one would leave the surplus rows standing as phantom sets. Not only the
    # tail can be surplus: a checkpoint correcting the board backwards, or a point's
    # delete, can take out any set at all.
    db.execute(
        delete(MatchSet).where(
            MatchSet.match_id == match_id, MatchSet.set_number.not_in(list(merged))
        )
    )
    # RETURNING does not promise an order, and the response is a score to read.
    return sorted(sets, key=lambda match_set: match_set.set_number)


def _winner(set_won: bool | None) -> MatchSide | None:
    if set_won is None:
        return None
    return MatchSide.TRACKED if set_won else MatchSide.OPPONENT
