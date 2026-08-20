"""The set-score derivation, tested directly rather than only through the ingest route.

Every analytics figure this project reports will be a query of this shape over the same
points, so the tally is worth pinning on its own: what counts as a game won, when a set
has a winner, and what happens to a row an earlier recompute left behind.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.match_sets import recompute_match_sets
from matchpoint_api.models import Match, MatchSet, MatchSide
from tests.factories import make_match, make_match_set, make_point


def _game(session: Session, match: Match, sequence: int, *, won: bool, **overrides: object) -> None:
    """A point that closed a game, which is the only kind the tally counts."""
    make_point(
        session, match_id=match.id, sequence=sequence, won=won, is_game_end=True, **overrides
    )


def test_a_set_in_flight_has_no_winner(db_session: Session) -> None:
    match = make_match(db_session)
    _game(db_session, match, 0, won=True)
    _game(db_session, match, 1, won=False)
    # A point mid-game, which counts towards no side's games.
    make_point(db_session, match_id=match.id, sequence=2, won=True)

    sets = recompute_match_sets(db_session, match.id)

    assert len(sets) == 1
    assert sets[0].set_number == 1
    assert sets[0].games_won_tracked == 1
    assert sets[0].games_won_opponent == 1
    assert sets[0].winner is None


def test_the_closing_point_names_the_set_winner(db_session: Session) -> None:
    match = make_match(db_session)
    _game(db_session, match, 0, won=True)
    _game(db_session, match, 1, won=False, is_set_end=True)

    sets = recompute_match_sets(db_session, match.id)

    assert sets[0].winner is MatchSide.OPPONENT


def test_a_set_won_by_the_tracked_player(db_session: Session) -> None:
    match = make_match(db_session)
    _game(db_session, match, 0, won=True, is_set_end=True)

    sets = recompute_match_sets(db_session, match.id)

    assert sets[0].winner is MatchSide.TRACKED
    assert sets[0].games_won_tracked == 1
    assert sets[0].games_won_opponent == 0


def test_each_set_gets_its_own_row(db_session: Session) -> None:
    match = make_match(db_session)
    _game(db_session, match, 0, won=True, is_set_end=True)
    _game(db_session, match, 1, won=False, set_number=2, is_set_end=True)
    _game(db_session, match, 2, won=True, set_number=3)

    sets = recompute_match_sets(db_session, match.id)

    assert [(row.set_number, row.winner) for row in sets] == [
        (1, MatchSide.TRACKED),
        (2, MatchSide.OPPONENT),
        (3, None),
    ]


def test_points_of_another_match_are_not_counted(db_session: Session) -> None:
    match = make_match(db_session)
    other = make_match(db_session)
    _game(db_session, match, 0, won=True)
    _game(db_session, other, 0, won=True)

    sets = recompute_match_sets(db_session, match.id)

    assert sets[0].games_won_tracked == 1


def test_a_second_recompute_overwrites_the_row_and_stamps_updated_at(db_session: Session) -> None:
    """The upsert is an INSERT as far as SQLAlchemy is concerned, so the column's
    onupdate never fires on the conflict path and the statement sets it by hand. Nothing
    else would notice: the tally would still be right, only its age would lie."""
    match = make_match(db_session)
    _game(db_session, match, 0, won=True)
    first = recompute_match_sets(db_session, match.id)
    assert first[0].games_won_tracked == 1
    assert first[0].created_at == first[0].updated_at

    _game(db_session, match, 1, won=True, is_set_end=True)
    second = recompute_match_sets(db_session, match.id)

    assert second[0].id == first[0].id
    assert second[0].games_won_tracked == 2
    assert second[0].winner is MatchSide.TRACKED
    assert second[0].created_at == first[0].created_at
    assert second[0].updated_at > second[0].created_at


def test_a_set_row_the_points_no_longer_support_is_deleted(db_session: Session) -> None:
    """An upsert can only add or overwrite, so a row above the highest set still derived
    would survive as a phantom final set, and analytics would report a set that never
    happened."""
    match = make_match(db_session)
    make_match_set(db_session, match_id=match.id, set_number=3)
    _game(db_session, match, 0, won=True)

    sets = recompute_match_sets(db_session, match.id)

    assert [row.set_number for row in sets] == [1]
    assert db_session.scalars(
        select(MatchSet.set_number).where(MatchSet.match_id == match.id)
    ).all() == [1]


def test_a_match_with_no_points_keeps_no_set_rows(db_session: Session) -> None:
    """Not reachable through ingest, which never accepts an empty batch, but the helper
    is what a match's set rows mean and an empty match means none."""
    match = make_match(db_session)
    make_match_set(db_session, match_id=match.id)

    assert recompute_match_sets(db_session, match.id) == []
    assert db_session.scalar(select(func.count()).select_from(MatchSet)) == 0


def test_an_unknown_match_derives_nothing(db_session: Session) -> None:
    assert recompute_match_sets(db_session, uuid.uuid4()) == []
