"""The analytics endpoints: aggregates over points, matches and derived sets (#172).

Every expected number here is computed by hand from the arranged rows and stated in
the assertion, so a wrong aggregate fails against arithmetic rather than against a
copy of the code's own answer.
"""

import uuid
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.models import (
    Coach,
    EndReason,
    FailureMode,
    MatchResult,
    MatchSide,
    ReturnOutcome,
    ServeOutcome,
    ShotType,
    Wing,
)
from tests.factories import (
    make_coach,
    make_match,
    make_match_set,
    make_player,
    make_point,
    sign_in,
)


@pytest.fixture
def coach(client: TestClient, db_session: Session) -> Coach:
    """The coach the client is signed in as; every analytics route needs one."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    return coach


# The season record and the season trend window are the calendar year the server is
# in, so the tests that assert over them derive their dates instead of pinning a year
# that would start failing every January.
THIS_YEAR = date.today().year
LAST_YEAR = THIS_YEAR - 1

# One suffix per endpoint, so the scoping tests cover the whole router.
ENDPOINTS = [
    "overview",
    "serve",
    "rally",
    "trends?window=last5",
    "head-to-head",
    "head-to-head/detail?opponent=somebody",
]


def _get(client: TestClient, player_id: uuid.UUID, suffix: str) -> Any:
    response = client.get(f"/players/{player_id}/analytics/{suffix}")
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("suffix", ENDPOINTS)
def test_routes_require_a_session(client: TestClient, suffix: str) -> None:
    response = client.get(f"/players/{uuid.uuid4()}/analytics/{suffix}")

    assert response.status_code == 401


@pytest.mark.parametrize("suffix", ENDPOINTS)
def test_routes_hide_another_coachs_player(
    client: TestClient, db_session: Session, coach: Coach, suffix: str
) -> None:
    other_coachs_player = make_player(db_session)

    response = client.get(f"/players/{other_coachs_player.id}/analytics/{suffix}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Player not found"


# --- overview ---


def test_overview_is_empty_before_any_data(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    body = _get(client, player.id, "overview")

    assert body == {
        "form": None,
        "recent_results": [],
        "hold_percentage": None,
        "return_games_won": None,
        "forced_to_unforced": None,
        "season_record": {"wins": 0, "losses": 0},
        "all_time_record": {"wins": 0, "losses": 0},
    }


def test_overview_records_and_form(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Twelve results: last year's go to all-time only, and form is the last five.

    This year's results by day, 1st to 10th: L L W W L W W L W W. Newest-first the
    last five are W W L W W (80%), the five before them W W L L L (40%), so the delta
    is +40. All time is 7 of 12 (58); the season is this year's 6 and 4.
    """
    player = make_player(db_session, coach_id=coach.id)
    results = ["loss", "loss", "win", "win", "loss", "win", "win", "loss", "win", "win"]
    for day, result in enumerate(results, start=1):
        make_match(
            db_session,
            player_id=player.id,
            played_on=date(THIS_YEAR, 7, day),
            result=MatchResult(result),
        )
    make_match(
        db_session, player_id=player.id, played_on=date(LAST_YEAR, 5, 1), result=MatchResult.WIN
    )
    make_match(
        db_session, player_id=player.id, played_on=date(LAST_YEAR, 5, 2), result=MatchResult.LOSS
    )

    body = _get(client, player.id, "overview")

    assert body["form"] == {
        "label": "Form (win % last 5)",
        "value": 80,
        "unit": "percent",
        "sample_size": "n=5",
        "baseline": 58,
        "delta": 40,
        "max": 100,
        "higher_is_better": True,
        "display": None,
    }
    assert body["recent_results"] == ["win", "win", "loss", "win", "win"]
    assert body["season_record"] == {"wins": 6, "losses": 4}
    assert body["all_time_record"] == {"wins": 7, "losses": 5}


def test_overview_point_metrics(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Hold and return rates come off game-end stamps, tiebreaks excluded.

    Two tracked-serve games (one held), one return game won, and a tiebreak-ending
    point that must move nothing. Forced wins 2, unforced losses 1: ratio 2.0.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0, is_game_end=True)
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        is_game_end=True,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        is_game_end=True,
        server=MatchSide.OPPONENT,
        serve1_box=None,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=3,
        is_game_end=True,
        in_tiebreak=True,
        serve1_outcome=ServeOutcome.ACE,
        end_reason=EndReason.ACE,
        wing=None,
        shot_type=None,
    )

    body = _get(client, player.id, "overview")

    assert body["hold_percentage"]["value"] == 50
    assert body["hold_percentage"]["sample_size"] == "n=2"
    assert body["return_games_won"]["value"] == 100
    assert body["return_games_won"]["sample_size"] == "n=1"
    assert body["forced_to_unforced"] == {
        "label": "Forced : Unforced ratio",
        "value": 2.0,
        "unit": "ratio",
        "sample_size": "n=3",
        "baseline": None,
        "delta": None,
        "max": 3,
        "higher_is_better": True,
        "display": None,
    }


def test_overview_ratio_without_unforced_errors_shows_the_count(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0)

    body = _get(client, player.id, "overview")

    assert body["forced_to_unforced"]["value"] == 1.0
    assert body["forced_to_unforced"]["display"] == "1:0"
    # No unforced errors means no finite ratio, so the bar fills rather than sitting a
    # third along the 0-3 scale the defined case is drawn on.
    assert body["forced_to_unforced"]["max"] == 1.0


# --- serve ---


def test_serve_is_empty_before_any_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    body = _get(client, player.id, "serve")

    empty_side = {
        "hero": None,
        "metrics": [],
        "breakdown": [],
        "fault_mode": {"first_serve": None, "second_serve": None},
        "trend": [],
    }
    assert body == {"serving": empty_side, "returning": empty_side}


def test_serving_metrics_and_breakdown(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Seven service points: 5 first serves in (3 won), an ace, a double fault,
    two break points (one saved), and one held game.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0)
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        serve1_outcome=ServeOutcome.ACE,
        end_reason=EndReason.ACE,
        wing=None,
        shot_type=None,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=3,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.IN,
        serve2_box=None,
        shot_type=ShotType.VOLLEY,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=4,
        won=False,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.FAULT,
        serve2_fault_mode=FailureMode.LONG,
        end_reason=EndReason.DOUBLE_FAULT,
        wing=None,
        shot_type=None,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=5,
        won=False,
        wing=Wing.BACKHAND,
        shot_type=ShotType.VOLLEY,
        is_break_point=True,
    )
    make_point(db_session, match_id=match.id, sequence=6, is_break_point=True, is_game_end=True)

    body = _get(client, player.id, "serve")
    serving = body["serving"]

    assert serving["hero"]["label"] == "Hold % (service games won)"
    assert serving["hero"]["value"] == 100
    assert serving["hero"]["sample_size"] == "n=1"
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in serving["metrics"]
    ] == [
        ("Break points saved", 50, "n=2"),
        ("1st serve in %", 71, "n=7"),
        ("1st serve points won", 60, "n=5"),
        ("2nd serve points won", 50, "n=2"),
        ("Double faults / set", 1.0, "n=1 sets"),
        ("Aces / match", 1.0, "n=1"),
    ]
    double_faults = serving["metrics"][4]
    assert double_faults["unit"] == "per_set"
    assert double_faults["max"] == 5
    assert double_faults["higher_is_better"] is False
    aces = serving["metrics"][5]
    assert aces["unit"] == "per_match"
    assert aces["higher_is_better"] is True
    assert serving["breakdown"] == [
        {"label": "Aces", "value": 1, "secondary_value": None, "max": 3},
        {"label": "Won on forehand", "value": 3, "secondary_value": None, "max": 3},
        {"label": "Won on backhand", "value": 0, "secondary_value": None, "max": 3},
        {"label": "Double faults", "value": 1, "secondary_value": None, "max": 3},
    ]


def test_returning_metrics_and_breakdown(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Five return points: a converted break point, a missed return, an opponent
    ace, a second-serve point won, and a return game closed out.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    opponent_serve = {
        "server": MatchSide.OPPONENT,
        "serve1_box": None,
    }
    make_point(
        db_session,
        match_id=match.id,
        sequence=0,
        **opponent_serve,
        return_outcome=ReturnOutcome.IN,
        is_break_point=True,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        **opponent_serve,
        return_outcome=ReturnOutcome.NET,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=None,
        shot_type=None,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        **opponent_serve,
        serve1_outcome=ServeOutcome.ACE,
        won=False,
        end_reason=EndReason.ACE,
        wing=None,
        shot_type=None,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=3,
        **opponent_serve,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_fault_mode=FailureMode.LONG,
        serve2_outcome=ServeOutcome.IN,
        return_outcome=ReturnOutcome.IN,
        end_reason=EndReason.MISTAKE,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=4,
        **opponent_serve,
        return_outcome=ReturnOutcome.IN,
        wing=Wing.BACKHAND,
        is_game_end=True,
    )

    body = _get(client, player.id, "serve")
    returning = body["returning"]

    assert returning["hero"]["label"] == "Return games won %"
    assert returning["hero"]["value"] == 100
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in returning["metrics"]
    ] == [
        ("Break points converted", 100, "n=1"),
        ("1st serve return points won", 50, "n=4"),
        ("2nd serve return points won", 100, "n=1"),
    ]
    assert returning["breakdown"] == [
        {"label": "Returned in", "value": 3, "secondary_value": None, "max": 3},
        {"label": "Return error (net)", "value": 1, "secondary_value": None, "max": 3},
        {"label": "Return error (long)", "value": 0, "secondary_value": None, "max": 3},
        {"label": "Return error (wide)", "value": 0, "secondary_value": None, "max": 3},
    ]


def test_serving_fault_modes_split_by_serve_number(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Four faulted first serves (2 net, 1 long, 1 wide) and one faulted second."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    faulted = {"serve1_outcome": ServeOutcome.FAULT, "serve1_box": None}
    make_point(db_session, match_id=match.id, sequence=0)
    for sequence, mode in enumerate(
        [FailureMode.NET, FailureMode.LONG, FailureMode.WIDE, FailureMode.NET], start=1
    ):
        make_point(
            db_session,
            match_id=match.id,
            sequence=sequence,
            **faulted,
            serve1_fault_mode=mode,
            serve2_outcome=ServeOutcome.IN,
        )
    make_point(
        db_session,
        match_id=match.id,
        sequence=5,
        **faulted,
        serve1_fault_mode=FailureMode.WIDE,
        serve2_outcome=ServeOutcome.FAULT,
        serve2_fault_mode=FailureMode.NET,
        won=False,
        end_reason=EndReason.DOUBLE_FAULT,
        wing=None,
        shot_type=None,
    )

    body = _get(client, player.id, "serve")

    # Five faulted first serves: 2 net, 1 long, 2 wide. One faulted second, into the net.
    assert body["serving"]["fault_mode"] == {
        "first_serve": {"net": 40, "long": 20, "wide": 40},
        "second_serve": {"net": 100, "long": 0, "wide": 0},
    }


def test_the_returning_side_reports_no_fault_modes(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A stored opponent fault mode is still not reported.

    Ingestion refuses one (`schemas/point.py`), the column allows it, and the
    returning card would be the opponent's placement if the query took the row.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(
        db_session,
        match_id=match.id,
        sequence=0,
        server=MatchSide.OPPONENT,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.LONG,
        serve2_outcome=ServeOutcome.IN,
        return_outcome=ReturnOutcome.IN,
    )

    body = _get(client, player.id, "serve")

    empty = {"first_serve": None, "second_serve": None}
    assert body["returning"]["fault_mode"] == empty
    assert body["serving"]["fault_mode"] == empty


def test_serve_trend_runs_oldest_to_most_recent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Three matches on consecutive days, each side counted where it served.

    Serving, by day: 2 first serves in; 1 of 2 in and its second landing; 1 of 2
    in and its second faulting. The opponent served in the middle match alone, so
    their series is that match by itself and starts at M1 too.
    """
    player = make_player(db_session, coach_id=coach.id)
    matches = [
        make_match(db_session, player_id=player.id, played_on=date(THIS_YEAR, 7, day))
        for day in (1, 2, 3)
    ]
    faulted = {"serve1_outcome": ServeOutcome.FAULT, "serve1_box": None}
    make_point(db_session, match_id=matches[0].id, sequence=0)
    make_point(db_session, match_id=matches[0].id, sequence=1)
    make_point(db_session, match_id=matches[1].id, sequence=0)
    make_point(
        db_session,
        match_id=matches[1].id,
        sequence=1,
        **faulted,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.IN,
    )
    make_point(
        db_session,
        match_id=matches[1].id,
        sequence=2,
        server=MatchSide.OPPONENT,
        serve1_box=None,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(
        db_session,
        match_id=matches[1].id,
        sequence=3,
        server=MatchSide.OPPONENT,
        serve1_box=None,
        serve1_outcome=ServeOutcome.FAULT,
        serve2_outcome=ServeOutcome.IN,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(db_session, match_id=matches[2].id, sequence=0)
    make_point(
        db_session,
        match_id=matches[2].id,
        sequence=1,
        **faulted,
        serve1_fault_mode=FailureMode.WIDE,
        serve2_outcome=ServeOutcome.FAULT,
        serve2_fault_mode=FailureMode.NET,
        won=False,
        end_reason=EndReason.DOUBLE_FAULT,
        wing=None,
        shot_type=None,
    )

    body = _get(client, player.id, "serve")

    assert body["serving"]["trend"] == [
        {"match": "M1", "first_serve_in": 100, "second_serve_in": None},
        {"match": "M2", "first_serve_in": 50, "second_serve_in": 100},
        {"match": "M3", "first_serve_in": 50, "second_serve_in": 0},
    ]
    assert body["returning"]["trend"] == [
        {"match": "M1", "first_serve_in": 50, "second_serve_in": 100}
    ]


def test_serve_trend_keeps_only_the_most_recent_matches(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Seven matches, the oldest the only one whose first serve missed."""
    player = make_player(db_session, coach_id=coach.id)
    oldest = make_match(db_session, player_id=player.id, played_on=date(THIS_YEAR, 7, 1))
    make_point(
        db_session,
        match_id=oldest.id,
        sequence=0,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.IN,
    )
    for day in range(2, 8):
        match = make_match(db_session, player_id=player.id, played_on=date(THIS_YEAR, 7, day))
        make_point(db_session, match_id=match.id, sequence=0)

    body = _get(client, player.id, "serve")

    assert body["serving"]["trend"] == [
        {"match": f"M{position}", "first_serve_in": 100, "second_serve_in": None}
        for position in range(1, 7)
    ]


# --- rally ---


def test_rally_is_empty_before_any_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    body = _get(client, player.id, "rally")

    assert body == {
        "hero": None,
        "won_by_shot": [],
        "lost_by_shot": [],
        "outcome_mix": [],
        "errors_under_pressure": None,
        "errors_overall": None,
        "shot_frequency": [],
    }


def test_rally_stats(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Nine points: 3 forced wins, 2 gifted wins, 1 forced loss, 2 unforced losses
    (one on a break point), and an ace that joins no rally tally but the total.

    Each outcome-mix row groups the points one side's own last shot settled, so the
    two rows are deliberately different splits, not the same one twice.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0)
    make_point(db_session, match_id=match.id, sequence=1)
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
        shot_type=ShotType.VOLLEY,
    )
    make_point(db_session, match_id=match.id, sequence=3, won=False)
    make_point(
        db_session,
        match_id=match.id,
        sequence=4,
        won=False,
        end_reason=EndReason.MISTAKE,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=5,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
        shot_type=ShotType.LOB,
        is_break_point=True,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=6,
        serve1_outcome=ServeOutcome.ACE,
        end_reason=EndReason.ACE,
        wing=None,
        shot_type=None,
    )
    make_point(db_session, match_id=match.id, sequence=7)
    make_point(db_session, match_id=match.id, sequence=8, end_reason=EndReason.MISTAKE)

    body = _get(client, player.id, "rally")

    assert body["hero"]["value"] == 1.5
    assert body["hero"]["sample_size"] == "n=5"
    assert body["won_by_shot"] == [
        {"label": "Forehand drive", "value": 4, "secondary_value": None, "max": 4},
        {"label": "Backhand volley", "value": 1, "secondary_value": None, "max": 4},
    ]
    assert body["lost_by_shot"] == [
        {"label": "Forehand drive", "value": 1, "secondary_value": 1, "max": 2},
        {"label": "Backhand lob", "value": 1, "secondary_value": 0, "max": 2},
    ]
    # You: 3 forced wins against 2 unforced losses. Opponents: 1 winner of their own
    # against the 2 unforced errors that handed points over.
    assert body["outcome_mix"] == [
        {"label": "You", "forced": 60, "unforced": 40},
        {"label": "Opponents", "forced": 33, "unforced": 67},
    ]
    assert body["errors_under_pressure"]["value"] == 100
    assert body["errors_under_pressure"]["sample_size"] == "n=1"
    assert body["errors_under_pressure"]["higher_is_better"] is False
    assert body["errors_overall"]["value"] == 22
    assert body["errors_overall"]["sample_size"] == "n=9"
    assert body["shot_frequency"] == [
        {"shot": "Drive", "share": 0.8},
        {"shot": "Volley", "share": 0.2},
        {"shot": "Drop shot", "share": 0},
        {"shot": "Lob", "share": 0},
    ]


# --- set and phase filters ---

# One point per phase, plus the plain point below, so a phase query has both a row it
# must reach and seven it must leave out. Every name here is a column the capture
# client stamps; nothing in this list is derived by the server (#227).
PHASE_STAMPS = [
    ("tiebreaks", "in_tiebreak"),
    ("break_points", "is_break_point"),
    ("game_points", "is_game_point"),
    ("set_points", "is_set_point"),
    ("match_points", "is_match_point"),
    ("game_ending", "is_game_end"),
    ("set_ending", "is_set_end"),
]


def test_serve_narrows_to_one_set(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Four service points over two sets: set 1 holds a game, set 2 double-faults once.

    The per-set denominator is counted off the same narrowed rows, so a one-set query
    divides by one set and not by the two the match holds.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0)
    make_point(db_session, match_id=match.id, sequence=1, is_game_end=True)
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        set_number=2,
        won=False,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.FAULT,
        serve2_fault_mode=FailureMode.LONG,
        end_reason=EndReason.DOUBLE_FAULT,
        wing=None,
        shot_type=None,
    )
    make_point(db_session, match_id=match.id, sequence=3, set_number=2)

    first = _get(client, player.id, "serve?set_number=1")["serving"]
    second = _get(client, player.id, "serve?set_number=2")["serving"]

    assert first["hero"]["value"] == 100
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in first["metrics"]
    ] == [
        ("1st serve in %", 100, "n=2"),
        ("1st serve points won", 100, "n=2"),
        ("Double faults / set", 0.0, "n=1 sets"),
        ("Aces / match", 0.0, "n=1"),
    ]
    # No game ended inside set 2, so its hold percentage has nothing to count.
    assert second["hero"] is None
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in second["metrics"]
    ] == [
        ("1st serve in %", 50, "n=2"),
        ("1st serve points won", 100, "n=1"),
        ("2nd serve points won", 0, "n=1"),
        ("Double faults / set", 1.0, "n=1 sets"),
        ("Aces / match", 0.0, "n=1"),
    ]


def test_rally_narrows_to_one_set(client: TestClient, db_session: Session, coach: Coach) -> None:
    """A forehand drive won in set 1, a backhand volley won in set 2."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0)
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        set_number=2,
        wing=Wing.BACKHAND,
        shot_type=ShotType.VOLLEY,
    )

    body = _get(client, player.id, "rally?set_number=2")

    assert body["errors_overall"]["sample_size"] == "n=1"
    assert body["won_by_shot"] == [
        {"label": "Backhand volley", "value": 1, "secondary_value": None, "max": 1}
    ]
    assert body["shot_frequency"] == [
        {"shot": "Drive", "share": 0},
        {"shot": "Volley", "share": 1.0},
        {"shot": "Drop shot", "share": 0},
        {"shot": "Lob", "share": 0},
    ]


@pytest.mark.parametrize(
    ("phase", "counted"), [("full", 8), *((phase, 1) for phase, _ in PHASE_STAMPS)]
)
def test_phase_counts_only_the_points_carrying_its_stamp(
    client: TestClient, db_session: Session, coach: Coach, phase: str, counted: int
) -> None:
    """One point per stamp plus one carrying none; full match reaches all eight."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0)
    for sequence, (_, column) in enumerate(PHASE_STAMPS, start=1):
        make_point(db_session, match_id=match.id, sequence=sequence, **{column: True})

    body = _get(client, player.id, f"rally?phase={phase}")

    assert body["errors_overall"]["sample_size"] == f"n={counted}"


def test_serve_narrows_to_a_phase(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Two break points served and one ordinary point, all won."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0, is_break_point=True)
    make_point(db_session, match_id=match.id, sequence=1, is_break_point=True)
    make_point(db_session, match_id=match.id, sequence=2)

    serving = _get(client, player.id, "serve?phase=break_points")["serving"]

    assert serving["metrics"][0] == {
        "label": "Break points saved",
        "value": 100,
        "unit": "percent",
        "sample_size": "n=2",
        "baseline": None,
        "delta": None,
        "max": 100,
        "higher_is_better": True,
        "display": None,
    }


def test_tiebreak_phase_leaves_hold_percentage_null_rather_than_zero(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Nobody holds serve in a tiebreak, the players alternating inside one.

    So the hold percentage has no games to count and stays null, which the schema
    reserves for "the data to compute it does not exist". A zero would instead read
    as every service game lost.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0, is_game_end=True)
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        game_number=13,
        in_tiebreak=True,
        is_game_end=True,
        is_set_end=True,
    )

    serving = _get(client, player.id, "serve?phase=tiebreaks")["serving"]

    assert serving["hero"] is None
    # The tiebreak point was counted, so the null above is the missing game and not
    # an empty scope.
    assert [(metric["label"], metric["value"]) for metric in serving["metrics"]] == [
        ("1st serve in %", 100),
        ("1st serve points won", 100),
        ("Double faults / set", 0.0),
        ("Aces / match", 0.0),
    ]


def test_returning_breakdown_narrows_with_the_rest_of_the_payload(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A return in play in set 1, a return netted in set 2.

    The breakdown is its own query over the points rather than a slice of the tallies
    above it, so an unscoped one would sit a filtered hero beside every return the
    player has ever hit.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    opponent_serve = {"server": MatchSide.OPPONENT, "serve1_box": None}
    make_point(
        db_session,
        match_id=match.id,
        sequence=0,
        **opponent_serve,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        set_number=2,
        **opponent_serve,
        return_outcome=ReturnOutcome.NET,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=None,
        shot_type=None,
    )

    returning = _get(client, player.id, "serve?set_number=2")["returning"]

    assert returning["breakdown"] == [
        {"label": "Returned in", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Return error (net)", "value": 1, "secondary_value": None, "max": 1},
        {"label": "Return error (long)", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Return error (wide)", "value": 0, "secondary_value": None, "max": 1},
    ]


def test_set_and_phase_narrow_together(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A break point in each set, and an ordinary point in set 2."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0, is_break_point=True)
    make_point(db_session, match_id=match.id, sequence=1, set_number=2, is_break_point=True)
    make_point(db_session, match_id=match.id, sequence=2, set_number=2)

    serving = _get(client, player.id, "serve?set_number=2&phase=break_points")["serving"]

    assert (serving["metrics"][0]["label"], serving["metrics"][0]["sample_size"]) == (
        "Break points saved",
        "n=1",
    )


def test_overview_ignores_a_scope_it_does_not_offer(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The overview declares no filter, so a scope sent to it changes nothing (#227).

    Four of its fields are counted over matches rather than points and could not
    honour one; answering the whole payload unscoped is the deliberate choice.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=match.id, sequence=0, is_game_end=True)
    make_point(db_session, match_id=match.id, sequence=1, set_number=2, is_game_end=True, won=False)

    assert _get(client, player.id, "overview?set_number=1&phase=tiebreaks") == _get(
        client, player.id, "overview"
    )


@pytest.mark.parametrize("suffix", ["serve", "rally"])
@pytest.mark.parametrize(
    "query", ["set_number=0", "set_number=6", "set_number=first", "phase=deciding_set"]
)
def test_filters_reject_a_value_outside_the_contract(
    client: TestClient, db_session: Session, coach: Coach, suffix: str, query: str
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.get(f"/players/{player.id}/analytics/{suffix}?{query}")

    assert response.status_code == 422


# --- per-match scoping ---

# The match-scoped router answers the same two tabs, so its tests cover the same pair.
MATCH_ENDPOINTS = ["serve", "rally"]


def _get_match(client: TestClient, match_id: uuid.UUID, suffix: str) -> Any:
    response = client.get(f"/matches/{match_id}/analytics/{suffix}")
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("suffix", MATCH_ENDPOINTS)
def test_match_routes_require_a_session(client: TestClient, suffix: str) -> None:
    response = client.get(f"/matches/{uuid.uuid4()}/analytics/{suffix}")

    assert response.status_code == 401


@pytest.mark.parametrize("suffix", MATCH_ENDPOINTS)
def test_match_routes_hide_another_coachs_match(
    client: TestClient, db_session: Session, coach: Coach, suffix: str
) -> None:
    other_coachs_match = make_match(db_session)

    response = client.get(f"/matches/{other_coachs_match.id}/analytics/{suffix}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Match not found"


def test_match_serve_stats_leave_the_players_other_matches_out(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two matches, one point of each kind in each: the scoped answer sees one match.

    Both sides are arranged, since the returning breakdown runs a query of its own
    and would otherwise stay player-wide while the metrics narrowed.
    """
    player = make_player(db_session, coach_id=coach.id)
    scoped = make_match(db_session, player_id=player.id)
    other = make_match(db_session, player_id=player.id)
    opponent_serve = {"server": MatchSide.OPPONENT, "serve1_box": None}
    make_point(db_session, match_id=scoped.id, sequence=0)
    make_point(
        db_session,
        match_id=scoped.id,
        sequence=1,
        **opponent_serve,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(
        db_session,
        match_id=other.id,
        sequence=0,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.IN,
    )
    make_point(
        db_session,
        match_id=other.id,
        sequence=1,
        **opponent_serve,
        return_outcome=ReturnOutcome.NET,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=None,
        shot_type=None,
    )

    body = _get_match(client, scoped.id, "serve")

    first_in = next(
        metric for metric in body["serving"]["metrics"] if metric["label"] == "1st serve in %"
    )
    assert (first_in["value"], first_in["sample_size"]) == (100, "n=1")
    assert body["returning"]["breakdown"] == [
        {"label": "Returned in", "value": 1, "secondary_value": None, "max": 1},
        {"label": "Return error (net)", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Return error (long)", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Return error (wide)", "value": 0, "secondary_value": None, "max": 1},
    ]
    # The same two figures over both matches, so the scoping is what the assertions
    # above are reading and not an arrangement that would answer the same either way.
    player_wide = _get(client, player.id, "serve")
    player_first_in = next(
        metric
        for metric in player_wide["serving"]["metrics"]
        if metric["label"] == "1st serve in %"
    )
    assert (player_first_in["value"], player_first_in["sample_size"]) == (50, "n=2")
    assert player_wide["returning"]["breakdown"][1]["value"] == 1
    # The fault mode and the trend run queries of their own, so each is asserted
    # scoped and player-wide too.
    assert body["serving"]["fault_mode"]["first_serve"] is None
    assert body["serving"]["trend"] == [
        {"match": "M1", "first_serve_in": 100, "second_serve_in": None}
    ]
    assert body["returning"]["trend"] == [
        {"match": "M1", "first_serve_in": 100, "second_serve_in": None}
    ]
    assert player_wide["serving"]["fault_mode"]["first_serve"] == {
        "net": 100,
        "long": 0,
        "wide": 0,
    }
    assert len(player_wide["serving"]["trend"]) == 2


def test_match_rally_stats_leave_the_players_other_matches_out(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A forced win in one match and an unforced loss in the other."""
    player = make_player(db_session, coach_id=coach.id)
    scoped = make_match(db_session, player_id=player.id)
    other = make_match(db_session, player_id=player.id)
    make_point(db_session, match_id=scoped.id, sequence=0)
    make_point(
        db_session,
        match_id=other.id,
        sequence=0,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
        shot_type=ShotType.LOB,
    )

    body = _get_match(client, scoped.id, "rally")

    assert body["won_by_shot"] == [
        {"label": "Forehand drive", "value": 1, "secondary_value": None, "max": 1}
    ]
    assert body["lost_by_shot"] == []
    assert body["outcome_mix"] == [{"label": "You", "forced": 100, "unforced": 0}]
    assert body["errors_overall"]["sample_size"] == "n=1"
    player_wide = _get(client, player.id, "rally")
    assert len(player_wide["lost_by_shot"]) == 1
    assert player_wide["errors_overall"]["sample_size"] == "n=2"


# --- trends ---


def test_trends_last5_windows_baselines_and_charts(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Ten 2026 matches plus two 2025 ones: the window is the newest five, the delta
    the five before, the baseline everything.

    2026 results by day, 1st to 10th: L L L W W W L W L W. The window holds 3 wins
    (60), the previous five 2 (40), all time 7 of 12 (58). Points sit in the newest
    match (window), the 5th (previous window) and 2025 (baseline only).
    """
    player = make_player(db_session, coach_id=coach.id)
    results_2026 = ["loss", "loss", "loss", "win", "win", "win", "loss", "win", "loss", "win"]
    matches = [
        make_match(
            db_session,
            player_id=player.id,
            played_on=date(2026, 8, day),
            result=MatchResult(result),
        )
        for day, result in enumerate(results_2026, start=1)
    ]
    for day in (1, 2):
        make_match(
            db_session,
            player_id=player.id,
            played_on=date(2025, 6, day),
            result=MatchResult.WIN,
        )
    newest, fifth = matches[9], matches[4]
    make_point(db_session, match_id=newest.id, sequence=0, is_game_end=True)
    make_point(
        db_session,
        match_id=newest.id,
        sequence=1,
        is_game_end=True,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
    )
    make_match_set(db_session, match_id=newest.id, games_won_tracked=6, games_won_opponent=4)
    make_point(db_session, match_id=fifth.id, sequence=0, is_game_end=True)
    older = make_match(
        db_session, player_id=player.id, played_on=date(2025, 6, 3), result=MatchResult.WIN
    )
    make_point(db_session, match_id=older.id, sequence=0, is_game_end=True)

    body = _get(client, player.id, "trends?window=last5")

    assert [
        (metric["label"], metric["value"], metric["baseline"], metric["delta"])
        for metric in body["metrics"]
    ] == [
        # All time is 8 of 13 results (62) once the third 2025 match joins in.
        ("Form (win %)", 60, 62, 20),
        ("Hold %", 50, 75, -50),
        ("Forced : Unforced ratio", 1.0, 3.0, None),
        ("Double faults / set", 0.0, 0.0, 0.0),
    ]
    assert body["metrics"][0]["sample_size"] == "n=5"
    assert body["metrics"][1]["sample_size"] == "n=2"
    assert body["distribution_label"] == "1st serve in %"
    assert body["distribution"] == [{"bucket": "95–100%", "matches": 1}]
    assert body["correlation"] == [{"unforced_errors": 1, "games_lost": 4}]

    last10 = _get(client, player.id, "trends?window=last10")
    assert last10["metrics"][0]["value"] == 50
    assert last10["metrics"][0]["delta"] is None


def test_trends_season_covers_this_year_with_no_delta(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    for day, result in enumerate(["win", "win", "loss"], start=1):
        make_match(
            db_session,
            player_id=player.id,
            played_on=date(THIS_YEAR, 8, day),
            result=MatchResult(result),
        )
    make_match(
        db_session, player_id=player.id, played_on=date(LAST_YEAR, 6, 1), result=MatchResult.WIN
    )

    body = _get(client, player.id, "trends?window=season")

    assert body["metrics"] == [
        {
            "label": "Form (win %)",
            "value": 67,
            "unit": "percent",
            "sample_size": "n=3",
            "baseline": 75,
            "delta": None,
            "max": 100,
            "higher_is_better": True,
            "display": None,
        }
    ]
    assert body["distribution"] == []
    assert body["correlation"] == []


def test_trends_distribution_buckets_are_contiguous(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One match at 50% first serves in, one at 75%: the gap buckets render as zero."""
    player = make_player(db_session, coach_id=coach.id)
    halves = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    make_point(db_session, match_id=halves.id, sequence=0)
    make_point(
        db_session,
        match_id=halves.id,
        sequence=1,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.IN,
        serve2_box=None,
    )
    quarters = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 2))
    for sequence in range(3):
        make_point(db_session, match_id=quarters.id, sequence=sequence)
    make_point(
        db_session,
        match_id=quarters.id,
        sequence=3,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.WIDE,
        serve2_outcome=ServeOutcome.IN,
        serve2_box=None,
    )

    body = _get(client, player.id, "trends?window=last5")

    assert body["distribution"] == [
        {"bucket": "50–55%", "matches": 1},
        {"bucket": "55–60%", "matches": 0},
        {"bucket": "60–65%", "matches": 0},
        {"bucket": "65–70%", "matches": 0},
        {"bucket": "70–75%", "matches": 0},
        {"bucket": "75–80%", "matches": 1},
    ]
    # Both matches have points but no derived set rows yet, so neither correlates.
    assert body["correlation"] == []


def test_trends_rejects_an_unknown_window(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.get(f"/players/{player.id}/analytics/trends?window=lastweek")

    assert response.status_code == 422


# --- head-to-head ---


def test_head_to_head_list_groups_on_the_normalised_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Spelling variants of one name are one matchup, whose display name is the
    newest; a resultless match and a nameless one join no matchup at all.
    """
    player = make_player(db_session, coach_id=coach.id)
    torres = [("torres", "win", 1), (" Torres ", "win", 2), ("Torres", "loss", 3)]
    for name, result, day in torres:
        make_match(
            db_session,
            player_id=player.id,
            opponent_name=name,
            played_on=date(2026, 8, day),
            result=MatchResult(result),
        )
    for result, day in [("win", 4), ("loss", 5)]:
        make_match(
            db_session,
            player_id=player.id,
            opponent_name="Naidoo",
            played_on=date(2026, 8, day),
            result=MatchResult(result),
        )
    make_match(
        db_session,
        player_id=player.id,
        played_on=date(2026, 8, 6),
        result=MatchResult.WIN,
    )
    make_match(db_session, player_id=player.id, opponent_name="Reyes", played_on=date(2026, 8, 7))

    body = _get(client, player.id, "head-to-head")

    assert body == [
        {
            "opponent_key": "torres",
            "opponent_name": "Torres",
            "meetings": 3,
            "record": {"wins": 2, "losses": 1},
            "win_rate": 67,
        },
        {
            "opponent_key": "naidoo",
            "opponent_name": "Naidoo",
            "meetings": 2,
            "record": {"wins": 1, "losses": 1},
            "win_rate": None,
        },
    ]


def test_head_to_head_list_is_empty_without_opponents(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    assert _get(client, player.id, "head-to-head") == []


def test_head_to_head_detail_404s_on_an_unknown_opponent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.get(f"/players/{player.id}/analytics/head-to-head/detail?opponent=nobody")

    assert response.status_code == 404
    assert response.json()["detail"] == "No matches against this opponent"


def test_head_to_head_detail_reaches_a_name_holding_a_slash(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A doubles pair is one free-text name, which a path segment could not carry."""
    player = make_player(db_session, coach_id=coach.id)
    make_match(
        db_session,
        player_id=player.id,
        opponent_name="Smith / Jones",
        played_on=date(2026, 8, 1),
        result=MatchResult.LOSS,
    )

    listed = _get(client, player.id, "head-to-head")
    assert listed[0]["opponent_key"] == "smith / jones"

    response = client.get(
        f"/players/{player.id}/analytics/head-to-head/detail",
        params={"opponent": listed[0]["opponent_key"]},
    )

    assert response.status_code == 200
    assert response.json()["opponent_name"] == "Smith / Jones"


def test_head_to_head_detail_before_any_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two meetings and nothing captured: the record renders, everything else is
    honestly empty, and one unclassifiable loss leaves the patterns at zero.
    """
    player = make_player(db_session, coach_id=coach.id)
    for result, day in [("win", 1), ("loss", 2)]:
        make_match(
            db_session,
            player_id=player.id,
            opponent_name="Reyes",
            played_on=date(2026, 8, day),
            result=MatchResult(result),
        )

    body = _get(client, player.id, "head-to-head/detail?opponent=reyes")

    assert body["opponent_key"] == "reyes"
    assert body["opponent_name"] == "Reyes"
    assert body["win_rate"] is None
    assert body["hero"]["label"] == "2 meetings · 1–1"
    assert body["hero"]["value"] == 50
    assert body["results"] == ["win", "loss"]
    assert body["slope"] is None
    assert body["loss_patterns"] == [
        {"label": "Late-set fade", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Broken early", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Tiebreak", "value": 0, "secondary_value": None, "max": 1},
    ]
    assert body["your_serve"] == []
    assert body["their_serve"] == []
    assert body["won_by_shot"] == []
    assert body["shot_frequency"] == []


def test_head_to_head_detail_stays_slopeless_when_points_are_missing(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    for day in range(1, 5):
        make_match(
            db_session,
            player_id=player.id,
            opponent_name="Quiet",
            played_on=date(2026, 8, day),
            result=MatchResult.WIN,
        )

    body = _get(client, player.id, "head-to-head/detail?opponent=quiet")

    assert body["meetings"] == 4
    assert body["slope"] is None


def test_head_to_head_detail_with_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Four meetings, oldest two lost: the slope halves differ where arranged.

    Each meeting has a held game (won, forced, forehand drive), an unforced loss on
    a tracked serve, and a break-point return converted only in the newer two. The
    second meeting adds an early break against serve; set rows classify the first
    loss as a fade (4 games in the deciding set) and the second as broken early.
    """
    player = make_player(db_session, coach_id=coach.id)
    meetings = [
        make_match(
            db_session,
            player_id=player.id,
            opponent_name="Ade",
            played_on=date(2026, 8, day),
            result=MatchResult(result),
        )
        for day, result in [(1, "loss"), (2, "loss"), (3, "win"), (4, "win")]
    ]
    for index, meeting in enumerate(meetings):
        make_point(db_session, match_id=meeting.id, sequence=0, is_game_end=True)
        make_point(
            db_session,
            match_id=meeting.id,
            sequence=1,
            won=False,
            end_reason=EndReason.MISTAKE,
            wing=Wing.BACKHAND,
        )
        converted = index >= 2
        make_point(
            db_session,
            match_id=meeting.id,
            sequence=2,
            server=MatchSide.OPPONENT,
            serve1_box=None,
            return_outcome=ReturnOutcome.IN,
            is_break_point=True,
            won=converted,
            wing=Wing.FOREHAND if converted else Wing.BACKHAND,
            shot_type=ShotType.VOLLEY,
        )
    make_point(
        db_session,
        match_id=meetings[1].id,
        sequence=3,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
        is_game_end=True,
        game_number=2,
    )
    make_match_set(
        db_session,
        match_id=meetings[0].id,
        games_won_tracked=4,
        games_won_opponent=6,
        winner=MatchSide.OPPONENT,
    )
    make_match_set(
        db_session,
        match_id=meetings[1].id,
        games_won_tracked=0,
        games_won_opponent=6,
        winner=MatchSide.OPPONENT,
    )

    body = _get(client, player.id, "head-to-head/detail?opponent=ade")

    assert body["meetings"] == 4
    assert body["record"] == {"wins": 2, "losses": 2}
    assert body["win_rate"] == 50
    assert body["hero"]["label"] == "4 meetings · 2–2"
    assert body["results"] == ["loss", "loss", "win", "win"]
    # First two meetings: held 2 of 3 games (67), converted 0 break points, forced
    # 2 against 3 unforced (ratio 0.67, scaled 22 of 100). Last two: all held, all
    # converted, ratio 4:2 (scaled 67).
    assert body["slope"] == [
        {"label": "Hold %", "first": 67, "last": 100},
        {"label": "BP conv", "first": 0, "last": 100},
        {"label": "F:UE", "first": 22, "last": 67},
    ]
    assert body["loss_patterns"] == [
        {"label": "Late-set fade", "value": 1, "secondary_value": None, "max": 2},
        {"label": "Broken early", "value": 1, "secondary_value": None, "max": 2},
        {"label": "Tiebreak", "value": 0, "secondary_value": None, "max": 2},
    ]
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in body["your_serve"]
    ] == [
        ("1st serve points won", 44, "n=9"),
        ("Double faults / set", 0.0, "n=4 sets"),
    ]
    assert [
        (metric["label"], metric["value"], metric["higher_is_better"])
        for metric in body["their_serve"]
    ] == [
        ("Their 1st serve points won", 50, False),
        ("Their aces / match", 0.0, False),
    ]
    assert body["won_by_shot"] == [
        {"label": "Forehand drive", "value": 4, "secondary_value": None, "max": 4},
        {"label": "Forehand volley", "value": 2, "secondary_value": None, "max": 4},
    ]
    assert body["shot_frequency"] == [
        {"shot": "Drive", "share": 0.67},
        {"shot": "Volley", "share": 0.33},
        {"shot": "Drop shot", "share": 0},
        {"shot": "Lob", "share": 0},
    ]


def test_head_to_head_detail_leaves_a_patternless_loss_unclassified(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Lost 3-6, serve held in the opening games, no tiebreak: none of the three fit."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(
        db_session,
        player_id=player.id,
        opponent_name="Plain",
        played_on=date(2026, 8, 1),
        result=MatchResult.LOSS,
    )
    make_match_set(
        db_session,
        match_id=match.id,
        games_won_tracked=3,
        games_won_opponent=6,
        winner=MatchSide.OPPONENT,
    )
    make_point(db_session, match_id=match.id, sequence=0, is_game_end=True)

    body = _get(client, player.id, "head-to-head/detail?opponent=plain")

    assert [row["value"] for row in body["loss_patterns"]] == [0, 0, 0]


def test_head_to_head_detail_classifies_a_tiebreak_loss_first(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A 6-7 deciding set would read as a fade, but the tiebreak names it first."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(
        db_session,
        player_id=player.id,
        opponent_name="Tie",
        played_on=date(2026, 8, 1),
        result=MatchResult.LOSS,
    )
    make_match_set(
        db_session,
        match_id=match.id,
        games_won_tracked=6,
        games_won_opponent=7,
        winner=MatchSide.OPPONENT,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=0,
        won=False,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
        in_tiebreak=True,
        game_number=13,
    )

    body = _get(client, player.id, "head-to-head/detail?opponent=tie")

    assert body["hero"]["label"] == "1 meeting · 0–1"
    assert body["loss_patterns"] == [
        {"label": "Late-set fade", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Broken early", "value": 0, "secondary_value": None, "max": 1},
        {"label": "Tiebreak", "value": 1, "secondary_value": None, "max": 1},
    ]
