"""The set-score derivation, tested directly rather than only through the ingest route.

Every analytics figure this project reports will be a query of this shape over the same
points, so the tally is worth pinning on its own: what counts as a game won, when a set
has a winner, how the newest checkpoint's board and the points after it combine, and
what happens to a row an earlier recompute left behind.
"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.match_sets import recompute_match_sets
from matchpoint_api.models import Match, MatchSet, MatchSide
from tests.factories import (
    make_match,
    make_match_set,
    make_point,
    make_score_checkpoint,
    snapshot_set,
)


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
    # clock_timestamp() re-samples the wall clock on every call, unlike now(), so the two
    # server_defaults on this row are independently evaluated and can differ by a
    # microsecond even on the same INSERT.
    assert abs((first[0].updated_at - first[0].created_at).total_seconds()) < 0.01

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


def _checkpoint(session: Session, match: Match, sequence: int, *sets: dict[str, Any]) -> None:
    make_score_checkpoint(session, match_id=match.id, sequence=sequence, after={"sets": list(sets)})


def _tally(sets: list[MatchSet]) -> list[tuple[int, int, int, MatchSide | None]]:
    return [(s.set_number, s.games_won_tracked, s.games_won_opponent, s.winner) for s in sets]


def test_a_checkpoint_alone_is_the_board(db_session: Session) -> None:
    """The coach catching up on a set nobody captured: the declared board is the
    score, winner included, with not one point behind it."""
    match = make_match(db_session)
    _checkpoint(
        db_session,
        match,
        0,
        snapshot_set(),
        snapshot_set(set_number=2, games_tracked=2, games_opponent=3, winner=None),
    )

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 6, 4, MatchSide.TRACKED), (2, 2, 3, None)]


def test_points_after_a_checkpoint_add_to_its_board(db_session: Session) -> None:
    """Capture resuming after a correction: the games in the set the checkpoint left
    open count on top of what it declared, and the closing point names the winner the
    checkpoint could not."""
    match = make_match(db_session)
    _checkpoint(
        db_session,
        match,
        5,
        snapshot_set(set_number=1, games_tracked=4, games_opponent=4, winner=None),
    )
    _game(db_session, match, 6, won=True)
    _game(db_session, match, 7, won=True, is_set_end=True)
    _game(db_session, match, 8, won=False, set_number=2)

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 6, 4, MatchSide.TRACKED), (2, 0, 1, None)]


def test_points_before_the_checkpoint_are_superseded_by_it(db_session: Session) -> None:
    """A correction: the board the coach declared replaces whatever the earlier points
    added up to, including a set the points had wrong."""
    match = make_match(db_session)
    _game(db_session, match, 0, won=True)
    _game(db_session, match, 1, won=True)
    _game(db_session, match, 2, won=True, is_set_end=True)
    _checkpoint(
        db_session,
        match,
        3,
        snapshot_set(set_number=1, games_tracked=1, games_opponent=2, winner=None),
    )

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 1, 2, None)]


def test_the_newest_checkpoint_wins(db_session: Session) -> None:
    match = make_match(db_session)
    _checkpoint(db_session, match, 9, snapshot_set(games_tracked=6, games_opponent=0))
    _checkpoint(db_session, match, 4, snapshot_set(games_tracked=6, games_opponent=4))

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 6, 0, MatchSide.TRACKED)]


def test_a_tail_point_stamped_into_a_closed_set_is_ignored(db_session: Session) -> None:
    """A point mis-stamped, or captured on a second device that never saw the
    correction, into a set the checkpoint had already closed cannot reopen it."""
    match = make_match(db_session)
    _checkpoint(
        db_session,
        match,
        3,
        snapshot_set(),
        snapshot_set(set_number=2, games_tracked=0, games_opponent=0, winner=None),
    )
    _game(db_session, match, 4, won=False, set_number=1)
    _game(db_session, match, 5, won=True, set_number=2)

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 6, 4, MatchSide.TRACKED), (2, 1, 0, None)]


def test_the_checkpoints_declared_winner_stands_over_the_tail(db_session: Session) -> None:
    """A set the coach declared closed stays closed as declared, whatever a later point
    stamped into it says; the tail only ever fills in a winner the board left null."""
    match = make_match(db_session)
    _checkpoint(db_session, match, 0, snapshot_set(winner="opponent"))
    _game(db_session, match, 1, won=True, is_set_end=True)

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 6, 4, MatchSide.OPPONENT)]


def test_a_backwards_correction_shrinks_the_set_list(db_session: Session) -> None:
    """The coach declaring the match is still in set 1 after three sets of rows had
    been derived: the surplus rows go, not only a tail past the highest set."""
    match = make_match(db_session)
    make_match_set(db_session, match_id=match.id, set_number=1)
    make_match_set(db_session, match_id=match.id, set_number=2)
    make_match_set(db_session, match_id=match.id, set_number=3)
    _checkpoint(db_session, match, 0, snapshot_set(games_tracked=3, games_opponent=3, winner=None))

    sets = recompute_match_sets(db_session, match.id)

    assert _tally(sets) == [(1, 3, 3, None)]
    assert db_session.scalars(
        select(MatchSet.set_number).where(MatchSet.match_id == match.id)
    ).all() == [1]


def test_a_deleted_point_takes_its_set_row_with_it(db_session: Session) -> None:
    """Undo of the one point that had opened a set: the recompute after the delete
    derives one set fewer, and the row for the set that no longer exists goes too."""
    match = make_match(db_session)
    _game(db_session, match, 0, won=True, is_set_end=True)
    make_match_set(db_session, match_id=match.id, set_number=2, winner=None)

    sets = recompute_match_sets(db_session, match.id)

    assert [row.set_number for row in sets] == [1]
    assert db_session.scalar(select(func.count()).select_from(MatchSet)) == 1


def test_the_fold_lands_on_the_same_answer_whatever_arrived_first(db_session: Session) -> None:
    """The property the sync layer relies on: a checkpoint flushed before or after the
    points around it derives the same rows, so no arrival order is the wrong one.
    Recomputed after each flush as the routes do, so a fold that carried state from
    the earlier recompute into the later one would show."""
    board = snapshot_set(set_number=1, games_tracked=5, games_opponent=5, winner=None)

    early = make_match(db_session)
    _checkpoint(db_session, early, 2, board)
    recompute_match_sets(db_session, early.id)
    _game(db_session, early, 0, won=False)
    _game(db_session, early, 3, won=True)
    first = _tally(recompute_match_sets(db_session, early.id))

    late = make_match(db_session)
    _game(db_session, late, 0, won=False)
    _game(db_session, late, 3, won=True)
    recompute_match_sets(db_session, late.id)
    _checkpoint(db_session, late, 2, board)
    second = _tally(recompute_match_sets(db_session, late.id))

    assert first == second == [(1, 6, 5, None)]
