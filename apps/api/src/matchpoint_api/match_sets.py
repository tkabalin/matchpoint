"""Deriving a match's set scores from the points captured against it.

`match_sets` rows are a cache of a group-by over `points`, never anything a client
sends (docs/data-model.md). Recomputing the whole match rather than folding in a
batch is what makes a late, partial or retried flush land on the same answer.
"""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from matchpoint_api.models import MatchSet, MatchSide, Point

# The columns a recompute owns. `winner` is included, and nulls back to None when the
# point that closed a set has yet to arrive.
_DERIVED = ("games_won_tracked", "games_won_opponent", "winner")


def recompute_match_sets(db: Session, match_id: uuid.UUID) -> list[MatchSet]:
    """Rewrite one match's set rows from its points, and return them in set order.

    Aggregated in Postgres rather than in Python: the tally is the same shape every
    analytics query over these points will be, and there is no reason to ship a
    match's points to the app to count them. The caller owns the commit.
    """
    tally = (
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
    rows = db.execute(tally).all()

    sets: list[MatchSet] = []
    if rows:
        statement = insert(MatchSet).values(
            [
                {
                    "match_id": match_id,
                    "set_number": row.set_number,
                    "games_won_tracked": row.games_won_tracked,
                    "games_won_opponent": row.games_won_opponent,
                    "winner": _winner(row.set_won),
                }
                for row in rows
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
    # the last one would leave the surplus rows standing as a phantom final set. Only
    # the tail can be surplus: points are append-only, so a set that had points once
    # has them still.
    highest = max((row.set_number for row in rows), default=0)
    db.execute(delete(MatchSet).where(MatchSet.match_id == match_id, MatchSet.set_number > highest))
    # RETURNING does not promise an order, and the response is a score to read.
    return sorted(sets, key=lambda match_set: match_set.set_number)


def _winner(set_won: bool | None) -> MatchSide | None:
    if set_won is None:
        return None
    return MatchSide.TRACKED if set_won else MatchSide.OPPONENT
