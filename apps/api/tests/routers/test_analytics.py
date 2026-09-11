"""The analytics endpoints: aggregates over points, matches and derived sets (#172).

Every expected number here is computed by hand from the arranged rows and stated in
the assertion, so a wrong aggregate fails against arithmetic rather than against a
copy of the code's own answer.
"""

import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.models import (
    Coach,
    CourtDepth,
    CourtSide,
    EndReason,
    FailureMode,
    Match,
    MatchResult,
    MatchSide,
    Player,
    RallyBucket,
    ReturnOutcome,
    ServeOutcome,
    ShotType,
    Surface,
    UnusualReason,
    Wing,
)
from tests.factories import (
    make_coach,
    make_match,
    make_player,
    make_point,
    sign_in,
    sign_in_player,
)


@pytest.fixture
def coach(client: TestClient, db_session: Session) -> Coach:
    """The coach the client is signed in as; every analytics route needs one."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    return coach


# The season record and the squad snapshot's period are the calendar year the server
# is in, so the tests that assert over them derive their dates instead of pinning a
# year that would start failing every January.
THIS_YEAR = date.today().year
LAST_YEAR = THIS_YEAR - 1

# One suffix per endpoint, so the scoping tests cover the whole router.
ENDPOINTS = [
    "overview",
    "serve",
    "rally",
    "opponents",
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
        "outcome": {"first_serve": None, "second_serve": None},
        "fault_mode": {"first_serve": None, "second_serve": None},
        "return_outcome": {"first_serve": [], "second_serve": []},
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


def test_serve_outcome_shares_split_by_serve_number(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Both sides' serve attempts as in/fault/ace, per serve number.

    Serving: four first serves, one in, one an ace and two faulted, then the two
    second serves those faults led to, one in and one faulted. Returning: three of
    the opponent's first serves, one in, one an ace and one faulted, then the second
    serve that fault led to, in.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    no_shot = {"wing": None, "shot_type": None}
    opponent_serve = {"server": MatchSide.OPPONENT, "serve1_box": None}
    make_point(db_session, match_id=match.id, sequence=0)
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        serve1_outcome=ServeOutcome.ACE,
        end_reason=EndReason.ACE,
        **no_shot,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.IN,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=3,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_fault_mode=FailureMode.NET,
        serve2_outcome=ServeOutcome.FAULT,
        serve2_fault_mode=FailureMode.LONG,
        won=False,
        end_reason=EndReason.DOUBLE_FAULT,
        **no_shot,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=4,
        **opponent_serve,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=5,
        **opponent_serve,
        serve1_outcome=ServeOutcome.ACE,
        won=False,
        end_reason=EndReason.ACE,
        **no_shot,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=6,
        **opponent_serve,
        serve1_outcome=ServeOutcome.FAULT,
        serve2_outcome=ServeOutcome.IN,
        return_outcome=ReturnOutcome.NET,
        won=False,
        end_reason=EndReason.MISTAKE,
        **no_shot,
    )

    body = _get(client, player.id, "serve")

    assert body["serving"]["outcome"] == {
        "first_serve": {"landed": 25, "fault": 50, "ace": 25},
        "second_serve": {"landed": 50, "fault": 50, "ace": 0},
    }
    # Two of the opponent's three first serves landed, which is 67% to the same
    # rounding the "1st serve in %" metric uses, and a third of them were aces. The
    # landed share is what is left of the 67 once the aces come out of it, so the
    # three still total 100 exactly.
    assert body["returning"]["outcome"] == {
        "first_serve": {"landed": 34, "fault": 33, "ace": 33},
        "second_serve": {"landed": 100, "fault": 0, "ace": 0},
    }


def test_return_outcomes_split_by_serve_number(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Six of the opponent's serves returned, four of them first serves.

    First serves: two returned in, one netted, one long. Second serves: one in, one
    wide. The player's own service point carries no return of anyone's.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    opponent_serve = {"server": MatchSide.OPPONENT, "serve1_box": None}
    missed = {"won": False, "end_reason": EndReason.MISTAKE, "wing": None, "shot_type": None}
    second_serve = {"serve1_outcome": ServeOutcome.FAULT, "serve2_outcome": ServeOutcome.IN}
    for sequence in range(2):
        make_point(
            db_session,
            match_id=match.id,
            sequence=sequence,
            **opponent_serve,
            return_outcome=ReturnOutcome.IN,
        )
    for sequence, outcome in enumerate([ReturnOutcome.NET, ReturnOutcome.LONG], start=2):
        make_point(
            db_session,
            match_id=match.id,
            sequence=sequence,
            **opponent_serve,
            return_outcome=outcome,
            **missed,
        )
    make_point(
        db_session,
        match_id=match.id,
        sequence=4,
        **opponent_serve,
        **second_serve,
        return_outcome=ReturnOutcome.IN,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=5,
        **opponent_serve,
        **second_serve,
        return_outcome=ReturnOutcome.WIDE,
        **missed,
    )
    make_point(db_session, match_id=match.id, sequence=6)

    body = _get(client, player.id, "serve")

    def rows(**percentages: int) -> list[dict[str, Any]]:
        return [
            {
                "label": label,
                "value": percentages.get(label.lower(), 0),
                "secondary_value": None,
                "max": 100,
            }
            for label in ("In", "Net", "Long", "Wide")
        ]

    assert body["returning"]["return_outcome"] == {
        "first_serve": rows(**{"in": 50, "net": 25, "long": 25}),
        "second_serve": rows(**{"in": 50, "wide": 50}),
    }
    # The serving card asks about the opponent's return, which capture never records.
    assert body["serving"]["return_outcome"] == {"first_serve": [], "second_serve": []}


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

# The three helpers below spell out the fixed rows a point-ender card always carries,
# so an assertion states only the counts the arranged points actually produced.
SHOT_TYPES = ("Drive", "Volley", "Dropshot", "Lob")
COURT_ZONES = (
    "Deuce short",
    "Deuce deep",
    "Ad short",
    "Ad deep",
    "Net",
    "Long",
    "Wide",
)


def _shot_rows(ceiling: int, **counts: int) -> list[dict[str, Any]]:
    return [
        {
            "label": label,
            "value": counts.get(label.lower(), 0),
            "secondary_value": None,
            "max": ceiling,
        }
        for label in SHOT_TYPES
    ]


def _zone_rows(**counts: int) -> list[dict[str, Any]]:
    return [
        {"zone": zone, "count": counts.get(zone.lower().replace(" ", "_"), 0)}
        for zone in COURT_ZONES
    ]


def _styles_at_zero(forced: str, unforced: str, unusual: str) -> list[dict[str, Any]]:
    """One side's three cards with nothing counted on any of them."""
    empty = {
        "wing": {"forehand": 0, "backhand": 0},
        "shot_type": [],
        "court_zones": [],
        "unusual_reasons": None,
    }
    return [
        {"kind": "forced", "label": forced, "count": 0, "detail": empty},
        {"kind": "unforced", "label": unforced, "count": 0, "detail": empty},
        {
            "kind": "unusual",
            "label": unusual,
            "count": 0,
            "detail": {
                "wing": None,
                "shot_type": [],
                "court_zones": [],
                "unusual_reasons": [],
            },
        },
    ]


def test_rally_is_empty_before_any_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    body = _get(client, player.id, "rally")

    assert body == {
        "hero": None,
        "won": 0,
        "lost": 0,
        "won_by_shot": [],
        "lost_by_shot": [],
        "outcome_mix": [],
        "styles": {
            "you": _styles_at_zero(
                "Forced (your pressure)",
                "Unforced (their free error)",
                "Unusual (in your favor)",
            ),
            "opponents": _styles_at_zero(
                "Forced (their pressure)",
                "Unforced (your free error)",
                "Unusual (against you)",
            ),
        },
        "errors_under_pressure": None,
        "errors_overall": None,
        "shot_frequency": {"you": [], "opponents": []},
        "rally_length": [],
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
    # Every point, the ace included, where the styles below count rally endings alone.
    assert (body["won"], body["lost"]) == (6, 3)
    # Nine points and not one of them bucketed, so the histogram stays empty rather
    # than drawing four zeros.
    assert body["rally_length"] == []
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
    # Five wins carried a shot (4 drives and a volley) against three losses (2 drives
    # and a lob), each side's shares taken over its own total.
    assert body["shot_frequency"] == {
        "you": [
            {"shot": "Drive", "share": 0.8},
            {"shot": "Volley", "share": 0.2},
            {"shot": "Drop shot", "share": 0},
            {"shot": "Lob", "share": 0},
        ],
        "opponents": [
            {"shot": "Drive", "share": 0.67},
            {"shot": "Volley", "share": 0},
            {"shot": "Drop shot", "share": 0},
            {"shot": "Lob", "share": 0.33},
        ],
    }


def test_rally_length_buckets_are_reported_whole(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two points in the shortest bucket, one in the third, and one with no bucket."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    for sequence, bucket in enumerate([RallyBucket.B1, RallyBucket.B1, RallyBucket.B3]):
        make_point(db_session, match_id=match.id, sequence=sequence, rally_length_bucket=bucket)
    make_point(db_session, match_id=match.id, sequence=3)

    body = _get(client, player.id, "rally")

    # All four bars, the empty ones included: the gaps are the shape a coach reads.
    assert body["rally_length"] == [
        {"label": "1–3 shots", "count": 2},
        {"label": "4–6 shots", "count": 0},
        {"label": "7–9 shots", "count": 1},
        {"label": "10+ shots", "count": 0},
    ]


def test_point_ender_styles(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Ten points, one of every shape a style card has to survive.

    Won: 3 forced (2 forehand drives and a backhand volley, landing ad short, ad
    deep and in the net), 1 unforced backhand lob landing deuce short, and 3
    unusual, one of which never recorded why. Lost: a forced backhand lob that went
    long, and a missed return that records no shot at all. The ace belongs to the
    serve tab and is on none of the six cards.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    in_court = {"ball_in": True}
    make_point(
        db_session,
        match_id=match.id,
        sequence=0,
        **in_court,
        ball_half=CourtSide.AD,
        ball_depth=CourtDepth.SHORT,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=1,
        wing=Wing.BACKHAND,
        shot_type=ShotType.VOLLEY,
        ball_in=False,
        ball_out_mode=FailureMode.NET,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=2,
        **in_court,
        ball_half=CourtSide.AD,
        ball_depth=CourtDepth.DEEP,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=3,
        end_reason=EndReason.MISTAKE,
        wing=Wing.BACKHAND,
        shot_type=ShotType.LOB,
        **in_court,
        ball_half=CourtSide.DEUCE,
        ball_depth=CourtDepth.SHORT,
    )
    unusual = {"end_reason": EndReason.UNUSUAL, "wing": None, "shot_type": None}
    make_point(
        db_session,
        match_id=match.id,
        sequence=4,
        **unusual,
        unusual_reason=UnusualReason.NET_TOUCH,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=5,
        **unusual,
        unusual_reason=UnusualReason.HINDRANCE,
    )
    make_point(db_session, match_id=match.id, sequence=6, **unusual)
    make_point(
        db_session,
        match_id=match.id,
        sequence=7,
        won=False,
        wing=Wing.BACKHAND,
        shot_type=ShotType.LOB,
        ball_in=False,
        ball_out_mode=FailureMode.LONG,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=8,
        won=False,
        server=MatchSide.OPPONENT,
        serve1_box=None,
        return_outcome=ReturnOutcome.NET,
        end_reason=EndReason.MISTAKE,
        wing=None,
        shot_type=None,
    )
    make_point(
        db_session,
        match_id=match.id,
        sequence=9,
        serve1_outcome=ServeOutcome.ACE,
        end_reason=EndReason.ACE,
        wing=None,
        shot_type=None,
    )

    body = _get(client, player.id, "rally")

    assert body["styles"]["you"] == [
        {
            "kind": "forced",
            "label": "Forced (your pressure)",
            "count": 3,
            "detail": {
                "wing": {"forehand": 2, "backhand": 1},
                "shot_type": _shot_rows(2, drive=2, volley=1),
                "court_zones": _zone_rows(ad_short=1, ad_deep=1, net=1),
                "unusual_reasons": None,
            },
        },
        {
            "kind": "unforced",
            "label": "Unforced (their free error)",
            "count": 1,
            "detail": {
                "wing": {"forehand": 0, "backhand": 1},
                "shot_type": _shot_rows(1, lob=1),
                "court_zones": _zone_rows(deuce_short=1),
                "unusual_reasons": None,
            },
        },
        {
            "kind": "unusual",
            "label": "Unusual (in your favor)",
            "count": 3,
            "detail": {
                "wing": None,
                "shot_type": [],
                "court_zones": [],
                # Tied counts fall back to the reason's own name, so this order is
                # the same on every run.
                "unusual_reasons": [
                    {"label": "Hindrance", "value": 1, "secondary_value": None, "max": 1},
                    {"label": "Net touch", "value": 1, "secondary_value": None, "max": 1},
                ],
            },
        },
    ]
    assert body["styles"]["opponents"] == [
        {
            "kind": "forced",
            "label": "Forced (their pressure)",
            "count": 1,
            "detail": {
                "wing": {"forehand": 0, "backhand": 1},
                "shot_type": _shot_rows(1, lob=1),
                "court_zones": _zone_rows(long=1),
                "unusual_reasons": None,
            },
        },
        {
            "kind": "unforced",
            "label": "Unforced (your free error)",
            "count": 1,
            # The missed return is counted, and describes nothing: its placement is
            # return_outcome's, so no shot and no final ball were recorded for it.
            "detail": {
                "wing": {"forehand": 0, "backhand": 0},
                "shot_type": [],
                "court_zones": [],
                "unusual_reasons": None,
            },
        },
        {
            "kind": "unusual",
            "label": "Unusual (against you)",
            "count": 0,
            "detail": {
                "wing": None,
                "shot_type": [],
                "court_zones": [],
                "unusual_reasons": [],
            },
        },
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
    assert body["shot_frequency"] == {
        "you": [
            {"shot": "Drive", "share": 0},
            {"shot": "Volley", "share": 1.0},
            {"shot": "Drop shot", "share": 0},
            {"shot": "Lob", "share": 0},
        ],
        "opponents": [],
    }


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
    "query",
    ["set_number=0", "set_number=6", "set_number=first", "phase=deciding_set", "surface=grasss"],
)
def test_filters_reject_a_value_outside_the_contract(
    client: TestClient, db_session: Session, coach: Coach, suffix: str, query: str
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.get(f"/players/{player.id}/analytics/{suffix}?{query}")

    assert response.status_code == 422


# --- the opponent axis (#244) ---


def _make_meeting(db_session: Session, player_id: uuid.UUID, name: str | None, day: int) -> Match:
    """One of the player's matches, dated so the newest spelling of a name is decidable."""
    return make_match(
        db_session, player_id=player_id, opponent_name=name, played_on=date(2026, 8, day)
    )


def test_opponents_lists_each_matchup_most_met_first(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Spelling variants are one matchup, whose name is the newest spelling.

    A nameless match joins no matchup, and another player's opponents are their own.
    Torres leads on two meetings; the two on one break to `abbott` before `Naidoo`,
    which is the normalised key ordering and not the display name's.
    """
    player = make_player(db_session, coach_id=coach.id)
    _make_meeting(db_session, player.id, " torres ", 1)
    _make_meeting(db_session, player.id, "Naidoo", 2)
    _make_meeting(db_session, player.id, "Torres", 3)
    _make_meeting(db_session, player.id, "abbott", 4)
    _make_meeting(db_session, player.id, None, 5)
    _make_meeting(db_session, make_player(db_session, coach_id=coach.id).id, "Reyes", 6)

    assert _get(client, player.id, "opponents") == [
        {"key": "torres", "name": "Torres", "matches": 2},
        {"key": "abbott", "name": "abbott", "matches": 1},
        {"key": "naidoo", "name": "Naidoo", "matches": 1},
    ]


def test_opponents_is_empty_without_a_named_opponent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    _make_meeting(db_session, player.id, None, 1)

    assert _get(client, player.id, "opponents") == []


def test_the_opponent_axis_counts_a_match_without_a_result(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A match carries points long before anyone records who won it.

    So the axis groups every match naming the opponent, not the resulted ones the
    win/loss record is counted over, and the picker's count says the same.
    """
    player = make_player(db_session, coach_id=coach.id)
    resulted = make_match(
        db_session,
        player_id=player.id,
        opponent_name="Torres",
        played_on=date(2026, 8, 1),
        result=MatchResult.WIN,
    )
    in_flight = _make_meeting(db_session, player.id, "Torres", 2)
    make_point(db_session, match_id=resulted.id, sequence=0)
    make_point(db_session, match_id=in_flight.id, sequence=0)

    body = _get(client, player.id, "rally?opponent_key=torres")

    assert body["errors_overall"]["sample_size"] == "n=2"
    assert _get(client, player.id, "opponents") == [
        {"key": "torres", "name": "Torres", "matches": 2}
    ]


def test_serve_narrows_to_one_opponent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two service points against Torres, one double-faulted against Naidoo."""
    player = make_player(db_session, coach_id=coach.id)
    torres = _make_meeting(db_session, player.id, "Torres", 1)
    naidoo = _make_meeting(db_session, player.id, "Naidoo", 2)
    make_point(db_session, match_id=torres.id, sequence=0)
    make_point(db_session, match_id=torres.id, sequence=1, is_game_end=True)
    make_point(
        db_session,
        match_id=naidoo.id,
        sequence=0,
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

    serving = _get(client, player.id, "serve?opponent_key=torres")["serving"]

    assert serving["hero"]["value"] == 100
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in serving["metrics"]
    ] == [
        ("1st serve in %", 100, "n=2"),
        ("1st serve points won", 100, "n=2"),
        ("Double faults / set", 0.0, "n=1 sets"),
        ("Aces / match", 0.0, "n=1"),
    ]


def test_rally_narrows_to_one_opponent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A forehand drive won against Torres, a backhand volley against Naidoo."""
    player = make_player(db_session, coach_id=coach.id)
    torres = _make_meeting(db_session, player.id, "Torres", 1)
    naidoo = _make_meeting(db_session, player.id, "Naidoo", 2)
    make_point(db_session, match_id=torres.id, sequence=0)
    make_point(
        db_session,
        match_id=naidoo.id,
        sequence=0,
        wing=Wing.BACKHAND,
        shot_type=ShotType.VOLLEY,
    )

    body = _get(client, player.id, "rally?opponent_key=naidoo")

    assert body["errors_overall"]["sample_size"] == "n=1"
    assert body["won_by_shot"] == [
        {"label": "Backhand volley", "value": 1, "secondary_value": None, "max": 1}
    ]


def test_overview_narrows_to_one_opponent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Three results against Torres and one against Naidoo, all this year.

    Every field narrows together: the record and the form are counted over the three
    meetings, and the hold percentage over the one service game held inside them,
    where all matches together hold half of two.
    """
    player = make_player(db_session, coach_id=coach.id)
    meetings = [
        make_match(
            db_session,
            player_id=player.id,
            opponent_name="Torres",
            played_on=date(THIS_YEAR, 7, day),
            result=MatchResult(result),
        )
        for day, result in enumerate(["win", "loss", "win"], start=1)
    ]
    make_point(db_session, match_id=meetings[0].id, sequence=0, is_game_end=True)
    naidoo = make_match(
        db_session,
        player_id=player.id,
        opponent_name="Naidoo",
        played_on=date(THIS_YEAR, 7, 4),
        result=MatchResult.WIN,
    )
    make_point(db_session, match_id=naidoo.id, sequence=0, is_game_end=True, won=False)

    body = _get(client, player.id, "overview?opponent_key=torres")

    assert body["recent_results"] == ["win", "loss", "win"]
    assert body["all_time_record"] == {"wins": 2, "losses": 1}
    assert body["season_record"] == {"wins": 2, "losses": 1}
    assert (body["form"]["value"], body["form"]["sample_size"]) == (67, "n=3")
    assert (body["hold_percentage"]["value"], body["hold_percentage"]["sample_size"]) == (
        100,
        "n=1",
    )
    assert _get(client, player.id, "overview")["hold_percentage"]["value"] == 50


def test_opponent_set_and_phase_narrow_together(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A break point in each set against Torres, and one in set 2 against Naidoo."""
    player = make_player(db_session, coach_id=coach.id)
    torres = _make_meeting(db_session, player.id, "Torres", 1)
    naidoo = _make_meeting(db_session, player.id, "Naidoo", 2)
    make_point(db_session, match_id=torres.id, sequence=0, is_break_point=True)
    make_point(db_session, match_id=torres.id, sequence=1, set_number=2, is_break_point=True)
    make_point(db_session, match_id=torres.id, sequence=2, set_number=2)
    make_point(db_session, match_id=naidoo.id, sequence=0, set_number=2, is_break_point=True)

    serving = _get(client, player.id, "serve?opponent_key=torres&set_number=2&phase=break_points")[
        "serving"
    ]

    assert (serving["metrics"][0]["label"], serving["metrics"][0]["sample_size"]) == (
        "Break points saved",
        "n=1",
    )


def test_an_opponent_key_reaches_any_spelling_of_the_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The key is trimmed and lowercased on the way in as well as on the way out.

    The display name stays exactly as the coach typed it, so a hand-typed key still
    lands on the matchup the picker would have handed back.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = _make_meeting(db_session, player.id, "  Torres  ", 1)
    make_point(db_session, match_id=match.id, sequence=0)

    assert _get(client, player.id, "opponents") == [
        {"key": "torres", "name": "  Torres  ", "matches": 1}
    ]

    response = client.get(
        f"/players/{player.id}/analytics/rally", params={"opponent_key": " TORRES "}
    )

    assert response.status_code == 200
    assert response.json()["errors_overall"]["sample_size"] == "n=1"


@pytest.mark.parametrize("suffix", ["overview", "serve", "rally"])
def test_an_unknown_opponent_key_is_refused(
    client: TestClient, db_session: Session, coach: Coach, suffix: str
) -> None:
    """A picker option outlives the match that put it there, so the tab says so."""
    player = make_player(db_session, coach_id=coach.id)
    _make_meeting(db_session, player.id, "Torres", 1)

    response = client.get(f"/players/{player.id}/analytics/{suffix}?opponent_key=naidoo")

    assert response.status_code == 404
    assert response.json()["detail"] == "No matches against this opponent"


@pytest.mark.parametrize("suffix", ["overview", "serve", "rally"])
def test_a_blank_opponent_key_is_refused(
    client: TestClient, db_session: Session, coach: Coach, suffix: str
) -> None:
    """Every opponent at once is the parameter omitted, never sent empty.

    A blank is a caller bug rather than a matchup nothing answers to, so it is the
    422 the parameter's own bound raises and not the unknown key's 404.
    """
    player = make_player(db_session, coach_id=coach.id)
    _make_meeting(db_session, player.id, "Torres", 1)

    response = client.get(f"/players/{player.id}/analytics/{suffix}?opponent_key=")

    assert response.status_code == 422


# --- the surface axis, player side (#225) ---


def test_serve_narrows_to_one_surface(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two service points on hard, one double-faulted on clay."""
    player = make_player(db_session, coach_id=coach.id)
    hard = make_match(
        db_session, player_id=player.id, surface=Surface.HARD, played_on=date(2026, 8, 1)
    )
    clay = make_match(
        db_session, player_id=player.id, surface=Surface.CLAY, played_on=date(2026, 8, 2)
    )
    make_point(db_session, match_id=hard.id, sequence=0)
    make_point(db_session, match_id=hard.id, sequence=1, is_game_end=True)
    make_point(
        db_session,
        match_id=clay.id,
        sequence=0,
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

    serving = _get(client, player.id, "serve?surface=hard")["serving"]

    assert serving["hero"]["value"] == 100
    assert [
        (metric["label"], metric["value"], metric["sample_size"]) for metric in serving["metrics"]
    ] == [
        ("1st serve in %", 100, "n=2"),
        ("1st serve points won", 100, "n=2"),
        ("Double faults / set", 0.0, "n=1 sets"),
        ("Aces / match", 0.0, "n=1"),
    ]


def test_rally_narrows_to_one_surface(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A forehand drive won on hard, a backhand volley won on clay."""
    player = make_player(db_session, coach_id=coach.id)
    hard = make_match(
        db_session, player_id=player.id, surface=Surface.HARD, played_on=date(2026, 8, 1)
    )
    clay = make_match(
        db_session, player_id=player.id, surface=Surface.CLAY, played_on=date(2026, 8, 2)
    )
    make_point(db_session, match_id=hard.id, sequence=0)
    make_point(
        db_session, match_id=clay.id, sequence=0, wing=Wing.BACKHAND, shot_type=ShotType.VOLLEY
    )

    body = _get(client, player.id, "rally?surface=clay")

    assert body["errors_overall"]["sample_size"] == "n=1"
    assert body["won_by_shot"] == [
        {"label": "Backhand volley", "value": 1, "secondary_value": None, "max": 1}
    ]


def test_overview_narrows_to_one_surface_including_the_record(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two wins on hard and a loss on clay, all this year.

    Every field narrows together, the same guarantee the opponent axis makes: the
    record and the form come off the same surface-scoped matches as the hold
    percentage, not off the unfiltered career the way an earlier version of this
    endpoint would have left them.
    """
    player = make_player(db_session, coach_id=coach.id)
    hard_matches = [
        make_match(
            db_session,
            player_id=player.id,
            surface=Surface.HARD,
            played_on=date(THIS_YEAR, 7, day),
            result=MatchResult.WIN,
        )
        for day in (1, 2)
    ]
    make_point(db_session, match_id=hard_matches[0].id, sequence=0, is_game_end=True)
    clay_match = make_match(
        db_session,
        player_id=player.id,
        surface=Surface.CLAY,
        played_on=date(THIS_YEAR, 7, 3),
        result=MatchResult.LOSS,
    )
    make_point(db_session, match_id=clay_match.id, sequence=0, is_game_end=True, won=False)

    body = _get(client, player.id, "overview?surface=hard")

    assert body["all_time_record"] == {"wins": 2, "losses": 0}
    assert body["season_record"] == {"wins": 2, "losses": 0}
    assert body["recent_results"] == ["win", "win"]
    assert (body["hold_percentage"]["value"], body["hold_percentage"]["sample_size"]) == (
        100,
        "n=1",
    )
    assert _get(client, player.id, "overview")["all_time_record"] == {"wins": 2, "losses": 1}


def test_surface_counts_a_match_with_no_opponent_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A surface filter must reach every match on that surface, named or not.

    `_matches_by_opponent` only ever selects matches carrying a name; the surface
    axis has its own query specifically so a nameless match isn't silently dropped.
    """
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id, surface=Surface.GRASS, opponent_name=None)
    make_point(db_session, match_id=match.id, sequence=0)

    assert _get(client, player.id, "rally?surface=grass")["errors_overall"]["sample_size"] == "n=1"


def test_surface_excludes_a_match_with_no_surface_recorded(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A match with no surface logged counts unfiltered, never under a filter."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id, surface=None)
    make_point(db_session, match_id=match.id, sequence=0)

    assert _get(client, player.id, "rally")["errors_overall"]["sample_size"] == "n=1"
    assert _get(client, player.id, "rally?surface=hard")["errors_overall"] is None


def test_surface_composes_with_opponent_set_and_phase(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A break point against Torres on hard in set 2, and one against Torres on clay."""
    player = make_player(db_session, coach_id=coach.id)
    hard = make_match(
        db_session,
        player_id=player.id,
        surface=Surface.HARD,
        opponent_name="Torres",
        played_on=date(2026, 8, 1),
    )
    clay = make_match(
        db_session,
        player_id=player.id,
        surface=Surface.CLAY,
        opponent_name="Torres",
        played_on=date(2026, 8, 2),
    )
    make_point(db_session, match_id=hard.id, sequence=0, is_break_point=True)
    make_point(db_session, match_id=hard.id, sequence=1, set_number=2, is_break_point=True)
    make_point(db_session, match_id=clay.id, sequence=0, set_number=2, is_break_point=True)

    serving = _get(
        client,
        player.id,
        "serve?opponent_key=torres&surface=hard&set_number=2&phase=break_points",
    )["serving"]

    assert (serving["metrics"][0]["label"], serving["metrics"][0]["sample_size"]) == (
        "Break points saved",
        "n=1",
    )


def test_opponents_narrows_by_surface(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Torres met on both surfaces, Naidoo only on clay.

    A hard filter still lists Torres, but at 1 meeting rather than 2, and drops
    Naidoo entirely rather than showing them at zero — a dead option the picker
    would otherwise offer.
    """
    player = make_player(db_session, coach_id=coach.id)
    make_match(
        db_session,
        player_id=player.id,
        opponent_name="Torres",
        surface=Surface.HARD,
        played_on=date(2026, 8, 1),
    )
    make_match(
        db_session,
        player_id=player.id,
        opponent_name="Torres",
        surface=Surface.CLAY,
        played_on=date(2026, 8, 2),
    )
    make_match(
        db_session,
        player_id=player.id,
        opponent_name="Naidoo",
        surface=Surface.CLAY,
        played_on=date(2026, 8, 3),
    )

    assert _get(client, player.id, "opponents?surface=hard") == [
        {"key": "torres", "name": "Torres", "matches": 1}
    ]


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
    # The serve outcomes and the return outcomes are two more queries of their own.
    assert body["serving"]["outcome"] == {
        "first_serve": {"landed": 100, "fault": 0, "ace": 0},
        "second_serve": None,
    }
    assert body["returning"]["return_outcome"]["first_serve"][0] == {
        "label": "In",
        "value": 100,
        "secondary_value": None,
        "max": 100,
    }
    assert player_wide["serving"]["outcome"]["first_serve"] == {
        "landed": 50,
        "fault": 50,
        "ace": 0,
    }
    assert player_wide["returning"]["return_outcome"]["first_serve"][0]["value"] == 50


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
    assert (body["won"], body["lost"]) == (1, 0)
    assert body["outcome_mix"] == [{"label": "You", "forced": 100, "unforced": 0}]
    assert body["errors_overall"]["sample_size"] == "n=1"
    assert [style["count"] for style in body["styles"]["you"]] == [1, 0, 0]
    assert [style["count"] for style in body["styles"]["opponents"]] == [0, 0, 0]
    player_wide = _get(client, player.id, "rally")
    assert len(player_wide["lost_by_shot"]) == 1
    assert (player_wide["won"], player_wide["lost"]) == (1, 1)
    assert player_wide["errors_overall"]["sample_size"] == "n=2"
    assert [style["count"] for style in player_wide["styles"]["opponents"]] == [0, 1, 0]


# --- squad members (#204) ---

SQUAD_PATH = "/squad/analytics/members"

FORCED_UNFORCED = "Forced : Unforced ratio"
FIRST_SERVE_IN = "1st serve in %"


def _squad(client: TestClient, surface: str | None = None) -> Any:
    params = {"surface": surface} if surface else {}
    response = client.get(SQUAD_PATH, params=params)
    assert response.status_code == 200
    return response.json()


def _captured_match(
    db_session: Session,
    player_id: uuid.UUID,
    played_on: date,
    *,
    forced: int = 0,
    mistake: int = 0,
    first_in: int = 0,
    faults: int = 0,
    result: MatchResult | None = None,
) -> None:
    """One match holding exactly the point tallies the two tracked stats read.

    Rally endings are logged on the opponent's serve and serve attempts as aces or
    double faults, so the forced : unforced ratio and the first-serve percentage can
    be arranged independently of each other.
    """
    match = make_match(db_session, player_id=player_id, played_on=played_on, result=result)
    sequence = 0
    for won, reason in [(True, EndReason.FORCED)] * forced + [(False, EndReason.MISTAKE)] * mistake:
        make_point(
            db_session,
            match_id=match.id,
            sequence=sequence,
            server=MatchSide.OPPONENT,
            serve1_box=None,
            return_outcome=ReturnOutcome.IN,
            won=won,
            end_reason=reason,
        )
        sequence += 1
    for landed in [True] * first_in + [False] * faults:
        make_point(
            db_session,
            match_id=match.id,
            sequence=sequence,
            won=landed,
            serve1_outcome=ServeOutcome.IN if landed else ServeOutcome.FAULT,
            serve1_box=CourtSide.DEUCE if landed else None,
            serve1_fault_mode=None if landed else FailureMode.NET,
            end_reason=EndReason.ACE if landed else EndReason.DOUBLE_FAULT,
            wing=None,
            shot_type=None,
        )
        sequence += 1


def test_squad_members_requires_a_session(client: TestClient) -> None:
    response = client.get(SQUAD_PATH)

    assert response.status_code == 401


def test_squad_members_is_empty_without_a_roster(client: TestClient, coach: Coach) -> None:
    assert _squad(client) == []


def test_squad_members_covers_a_player_with_no_matches(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A roster row with nothing behind it: absent figures, never zeroed ones."""
    player = make_player(db_session, coach_id=coach.id)

    assert _squad(client) == [
        {
            "player_id": str(player.id),
            "matches_logged_this_period": 0,
            # A record counts matches, so nothing played really is nil all, where
            # the two rates beside it are absent rather than zero.
            "period_record": {"wins": 0, "losses": 0},
            "last5": [],
            "forced_to_unforced_ratio": None,
            "first_serve_in_percent": None,
            "current_streak": None,
            "days_since_last_match": None,
            "tracked_stats": [],
        }
    ]


def test_squad_members_is_the_coachs_own_roster_by_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Surname order, as the roster list itself is, and nobody else's players."""
    zubair = make_player(db_session, coach_id=coach.id, last_name="Zubair")
    abbott = make_player(db_session, coach_id=coach.id, last_name="Abbott")
    make_player(db_session)

    body = _squad(client)

    assert [row["player_id"] for row in body] == [str(abbott.id), str(zubair.id)]


def test_squad_members_counts_the_period_and_the_streak(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The period is this calendar year; the streak and the results are not.

    Two matches this year (one still without a result) and one last year. The period
    counts two and its ratio is 2/1, last year's 5 forced wins left out of it. The
    streak reads off every result, so it is the one win of 1 July.
    """
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(
        db_session,
        player.id,
        date(THIS_YEAR, 7, 1),
        forced=2,
        mistake=1,
        result=MatchResult.WIN,
    )
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 2))
    _captured_match(db_session, player.id, date(LAST_YEAR, 5, 1), forced=5, result=MatchResult.LOSS)

    row = _squad(client)[0]

    assert row["matches_logged_this_period"] == 2
    assert row["forced_to_unforced_ratio"] == 2.0
    assert row["last5"] == ["loss", "win"]
    assert row["current_streak"] == {"outcome": "win", "length": 1}
    assert row["days_since_last_match"] == (date.today() - date(THIS_YEAR, 7, 2)).days


def test_squad_members_streak_runs_while_the_result_repeats(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Won, then lost three: the run is the three losses, and stops at the win."""
    player = make_player(db_session, coach_id=coach.id)
    for day, result in enumerate(["win", "loss", "loss", "loss"], start=1):
        make_match(
            db_session,
            player_id=player.id,
            played_on=date(THIS_YEAR, 7, day),
            result=MatchResult(result),
        )

    row = _squad(client)[0]

    assert row["current_streak"] == {"outcome": "loss", "length": 3}
    assert row["last5"] == ["win", "loss", "loss", "loss"]


def test_squad_members_days_since_the_last_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Counted off the newest match whether or not it has a result."""
    player = make_player(db_session, coach_id=coach.id)
    make_match(db_session, player_id=player.id, played_on=date.today() - timedelta(days=9))
    make_match(
        db_session,
        player_id=player.id,
        played_on=date.today() - timedelta(days=3),
        result=None,
    )

    assert _squad(client)[0]["days_since_last_match"] == 3


def test_squad_members_tracked_stats_measure_their_own_baseline(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Four matches, both stats moving: the latest value against the three before it.

    Ratios oldest first are 1.0, 3.0, 2.0, 0.5, so the current value is 0.5 and the
    baseline is 2.0, 3.0, 1.0: mean 2.0, deviation sqrt(2/3) = 0.82. First serves in
    are 60%, 70%, 50%, 40%, so 40 against a baseline of 50, 70, 60: mean 60,
    deviation sqrt(200/3) = 8.16.
    """
    player = make_player(db_session, coach_id=coach.id)
    tallies = [(5, 5, 12, 8), (15, 5, 14, 6), (10, 5, 10, 10), (5, 10, 8, 12)]
    for day, (forced, mistake, first_in, faults) in enumerate(tallies, start=1):
        _captured_match(
            db_session,
            player.id,
            date(THIS_YEAR, 7, day),
            forced=forced,
            mistake=mistake,
            first_in=first_in,
            faults=faults,
        )

    row = _squad(client)[0]

    assert row["tracked_stats"] == [
        {
            "key": "forced_to_unforced",
            "label": FORCED_UNFORCED,
            "unit": "ratio",
            "current": 0.5,
            "rolling_mean": 2.0,
            "rolling_std_dev": 0.82,
        },
        {
            "key": "first_serve_in",
            "label": FIRST_SERVE_IN,
            "unit": "percent",
            "current": 40,
            "rolling_mean": 60.0,
            "rolling_std_dev": 8.16,
        },
    ]
    # Summed over the period rather than averaged over the four ratios (1.62).
    assert row["forced_to_unforced_ratio"] == 1.4


def test_squad_members_skip_a_match_a_stat_cannot_answer(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A stat's series is the matches that can answer it, not every match.

    Rallies only on 2 July and no points at all on 3 July, so the ratio's series is
    0.5, 1.0, 2.0 while the serve percentage's is only 40 and 60. A baseline of one
    match has no spread, which is a real zero rather than an absent figure.
    """
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(
        db_session, player.id, date(THIS_YEAR, 7, 1), forced=10, mistake=5, first_in=12, faults=8
    )
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 2), forced=5, mistake=5)
    make_match(db_session, player_id=player.id, played_on=date(THIS_YEAR, 7, 3))
    _captured_match(
        db_session, player.id, date(THIS_YEAR, 7, 4), forced=5, mistake=10, first_in=8, faults=12
    )

    stats = {stat["key"]: stat for stat in _squad(client)[0]["tracked_stats"]}

    assert stats["forced_to_unforced"]["current"] == 0.5
    assert stats["forced_to_unforced"]["rolling_mean"] == 1.5
    assert stats["forced_to_unforced"]["rolling_std_dev"] == 0.5
    assert stats["first_serve_in"]["current"] == 40
    assert stats["first_serve_in"]["rolling_mean"] == 60.0
    assert stats["first_serve_in"]["rolling_std_dev"] == 0.0


def test_squad_members_omit_a_stat_without_a_baseline(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One match answers a stat but cannot be its own baseline, so neither is sent."""
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(
        db_session,
        player.id,
        date(THIS_YEAR, 7, 1),
        forced=10,
        mistake=5,
        first_in=12,
        faults=8,
        result=MatchResult.WIN,
    )

    row = _squad(client)[0]

    assert row["tracked_stats"] == []
    assert row["forced_to_unforced_ratio"] == 2.0
    assert row["current_streak"] == {"outcome": "win", "length": 1}


def test_squad_members_baseline_stops_at_ten_matches(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Twelve matches: the ten before the latest are the baseline, the eleventh is not.

    The oldest match is a 9.0 ratio against ten steady 2.0s. Counting it would put the
    mean at 2.64 with a deviation of 2.01; the window leaves it out, so the baseline
    is flat.
    """
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 1), forced=18, mistake=2)
    for day in range(2, 12):
        _captured_match(db_session, player.id, date(THIS_YEAR, 7, day), forced=10, mistake=5)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 12), forced=5, mistake=5)

    row = _squad(client)[0]

    assert row["tracked_stats"] == [
        {
            "key": "forced_to_unforced",
            "label": FORCED_UNFORCED,
            "unit": "ratio",
            "current": 1.0,
            "rolling_mean": 2.0,
            "rolling_std_dev": 0.0,
        }
    ]


def test_squad_members_ratio_stands_in_for_a_missing_denominator(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """No unforced errors at all leaves no ratio to take, so the count stands in."""
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 1), forced=3)

    assert _squad(client)[0]["forced_to_unforced_ratio"] == 3.0


def test_squad_members_baseline_skips_a_match_with_no_unforced_errors(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The stand-in count is a display convention, so it stays out of the series.

    Four matches, the second of them 12 forced and no unforced, which is points enough
    to count and still no denominator. Its stand-in value of 12.0 would put the
    baseline mean at 5.0 and the deviation at 4.97; left out, the series is 0.5 against
    2.0 and 1.0, so mean 1.5 and deviation 0.5.
    """
    player = make_player(db_session, coach_id=coach.id)
    for day, (forced, mistake) in enumerate([(5, 5), (12, 0), (10, 5), (5, 10)], start=1):
        _captured_match(
            db_session, player.id, date(THIS_YEAR, 7, day), forced=forced, mistake=mistake
        )

    stats = {stat["key"]: stat for stat in _squad(client)[0]["tracked_stats"]}

    assert stats["forced_to_unforced"]["current"] == 0.5
    assert stats["forced_to_unforced"]["rolling_mean"] == 1.5
    assert stats["forced_to_unforced"]["rolling_std_dev"] == 0.5
    # The period figure still sums the counts, where a zero denominator is the
    # whole period's rather than one match's.
    assert _squad(client)[0]["forced_to_unforced_ratio"] == 1.6


def test_squad_members_baseline_skips_a_match_of_too_few_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A match of nine points is arithmetic, not a data point, so it stays out (#239).

    Four matches, the second of them nine rally endings all lost and nine serves all
    faulted. Counting its 0.0 ratio would move the baseline from a mean of 1.5 and a
    deviation of 0.5 to 1.0 and 0.82, and the serve percentage's from 60 and 10 to 40
    and 29.44. A wider deviation is the divisor of the client's z-score, so it hides
    the decline the 0.5 and the 40 are.
    """
    player = make_player(db_session, coach_id=coach.id)
    tallies = [(10, 5, 14, 6), (0, 9, 0, 9), (5, 5, 10, 10), (5, 10, 8, 12)]
    for day, (forced, mistake, first_in, faults) in enumerate(tallies, start=1):
        _captured_match(
            db_session,
            player.id,
            date(THIS_YEAR, 7, day),
            forced=forced,
            mistake=mistake,
            first_in=first_in,
            faults=faults,
        )

    stats = {stat["key"]: stat for stat in _squad(client)[0]["tracked_stats"]}

    assert stats["forced_to_unforced"]["current"] == 0.5
    assert stats["forced_to_unforced"]["rolling_mean"] == 1.5
    assert stats["forced_to_unforced"]["rolling_std_dev"] == 0.5
    assert stats["first_serve_in"]["current"] == 40
    assert stats["first_serve_in"]["rolling_mean"] == 60.0
    assert stats["first_serve_in"]["rolling_std_dev"] == 10.0


def test_squad_members_current_skips_a_match_of_too_few_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The floor governs the newest match too, so `current` is never a fragment (#239).

    The latest match holds two rally endings and two serves, both of them bad. Counted,
    its 0.0 ratio would report against a mean of 1.17 and a deviation of 0.62, a
    z-score of 1.9 past the client's threshold of 1.5, on a match nobody really
    captured. Skipped, the newest usable match reports instead: 0.5 against 1.5, and 40
    against 60.
    """
    player = make_player(db_session, coach_id=coach.id)
    tallies = [(10, 5, 14, 6), (5, 5, 10, 10), (5, 10, 8, 12), (0, 2, 0, 2)]
    for day, (forced, mistake, first_in, faults) in enumerate(tallies, start=1):
        _captured_match(
            db_session,
            player.id,
            date(THIS_YEAR, 7, day),
            forced=forced,
            mistake=mistake,
            first_in=first_in,
            faults=faults,
        )

    stats = {stat["key"]: stat for stat in _squad(client)[0]["tracked_stats"]}

    assert stats["forced_to_unforced"]["current"] == 0.5
    assert stats["forced_to_unforced"]["rolling_mean"] == 1.5
    assert stats["first_serve_in"]["current"] == 40
    assert stats["first_serve_in"]["rolling_mean"] == 60.0


def test_squad_members_series_counts_a_match_at_the_point_floor(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Ten points is the floor and counts, each stat over its own ten.

    The oldest of three matches has exactly ten rally endings and exactly ten serves.
    In the baseline it makes the ratio's mean 1.5 with a deviation of 0.5 and the serve
    percentage's 60 with 10; dropped, each baseline would be the one match left and
    have no deviation at all.
    """
    player = make_player(db_session, coach_id=coach.id)
    tallies = [(5, 5, 5, 5), (10, 5, 14, 6), (5, 10, 8, 12)]
    for day, (forced, mistake, first_in, faults) in enumerate(tallies, start=1):
        _captured_match(
            db_session,
            player.id,
            date(THIS_YEAR, 7, day),
            forced=forced,
            mistake=mistake,
            first_in=first_in,
            faults=faults,
        )

    stats = {stat["key"]: stat for stat in _squad(client)[0]["tracked_stats"]}

    assert stats["forced_to_unforced"]["rolling_mean"] == 1.5
    assert stats["forced_to_unforced"]["rolling_std_dev"] == 0.5
    assert stats["first_serve_in"]["rolling_mean"] == 60.0
    assert stats["first_serve_in"]["rolling_std_dev"] == 10.0


def test_squad_members_omit_a_stat_left_with_one_countable_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two matches, one of them two points: nothing left to measure against (#239).

    The floor can leave a stat with a single value, which is the same position as a
    player on their first match, and the stat is left out rather than sent with a
    baseline of itself.
    """
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 1), forced=10, mistake=5)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 2), forced=1, mistake=1)

    row = _squad(client)[0]

    assert row["tracked_stats"] == []
    # The period ratio sums the counts, so the small match is still counted there,
    # weighed at the two points it is worth.
    assert row["forced_to_unforced_ratio"] == 1.83


# --- squad leaderboard figures on the same rows (#237) ---


def test_squad_members_period_record_and_serve_stop_at_the_year(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Both leaderboard figures are the period's, as the match count already is.

    Two results this year and one last, so the record is one all and last year's win
    is out of it. First serves in are 6 of 10 this year against 1 of 10 last, so the
    figure is 60% rather than the 35% both years together would give.
    """
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(
        db_session, player.id, date(THIS_YEAR, 7, 1), first_in=6, faults=4, result=MatchResult.WIN
    )
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 2), result=MatchResult.LOSS)
    _captured_match(
        db_session, player.id, date(LAST_YEAR, 5, 1), first_in=1, faults=9, result=MatchResult.WIN
    )

    row = _squad(client)[0]

    assert row["period_record"] == {"wins": 1, "losses": 1}
    assert row["first_serve_in_percent"] == 60


def test_squad_members_period_record_ignores_a_match_without_a_result(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A match logged but never resulted counts toward the period, not the record."""
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 1), result=MatchResult.WIN)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 2))

    row = _squad(client)[0]

    assert row["matches_logged_this_period"] == 2
    assert row["period_record"] == {"wins": 1, "losses": 0}


def test_squad_members_serve_percentage_is_absent_without_a_serve(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Rallies on the opponent's serve only, so the rate has no denominator."""
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(db_session, player.id, date(THIS_YEAR, 7, 1), forced=2, mistake=1)

    row = _squad(client)[0]

    assert row["forced_to_unforced_ratio"] == 2.0
    assert row["first_serve_in_percent"] is None


# --- squad trend (#237) ---

TREND_PATH = "/squad/analytics/trend"

# The window is the six Monday-to-Sunday weeks ending with the one today falls in, so
# every arranged date is derived from today rather than pinned to a calendar. One
# reading of the clock, so the two halves cannot land either side of a midnight.
_TODAY = date.today()
THIS_MONDAY = _TODAY - timedelta(days=_TODAY.weekday())


def _in_week(index: int, weekday: int = 0) -> date:
    """A date inside the window's week `index`, 0 being the oldest of the six."""
    return THIS_MONDAY - timedelta(weeks=5 - index) + timedelta(days=weekday)


def _values(client: TestClient, metric: str) -> Any:
    """The series' six values, having checked its labels run oldest to newest."""
    response = client.get(TREND_PATH, params={"metric": metric})
    assert response.status_code == 200
    body = response.json()
    assert [point["week"] for point in body] == [f"Wk {n}" for n in range(1, 7)]
    return [point["value"] for point in body]


def test_squad_trend_requires_a_session(client: TestClient) -> None:
    response = client.get(TREND_PATH, params={"metric": "record"})

    assert response.status_code == 401


def test_squad_trend_rejects_an_unknown_metric(client: TestClient, coach: Coach) -> None:
    response = client.get(TREND_PATH, params={"metric": "unforced_to_forced"})

    assert response.status_code == 422


def test_squad_trend_answers_the_weeks_without_a_roster(client: TestClient, coach: Coach) -> None:
    """The series is a list of weeks, and those exist whether or not anyone played."""
    assert _values(client, "record") == [None] * 6


def test_squad_trend_buckets_the_six_weeks_monday_to_sunday(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One point a week in order, a weekend in one bucket, quiet weeks left null.

    A win in the oldest week, a Sunday loss in the third, a Saturday win beside a
    Sunday loss in the fifth, and a win on the current week's Monday.
    """
    player = make_player(db_session, coach_id=coach.id)
    for played_on, result in [
        (_in_week(0), MatchResult.WIN),
        (_in_week(2, 6), MatchResult.LOSS),
        (_in_week(4, 5), MatchResult.WIN),
        (_in_week(4, 6), MatchResult.LOSS),
        (_in_week(5), MatchResult.WIN),
    ]:
        make_match(db_session, player_id=player.id, played_on=played_on, result=result)

    assert _values(client, "record") == [100, None, 0, None, 50, 100]


def test_squad_trend_stops_at_the_windows_first_monday(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The Sunday before the window is outside it, so its win moves nothing."""
    player = make_player(db_session, coach_id=coach.id)
    make_match(
        db_session,
        player_id=player.id,
        played_on=_in_week(0) - timedelta(days=1),
        result=MatchResult.WIN,
    )

    assert _values(client, "record") == [None] * 6


def test_squad_trend_stops_at_the_current_weeks_sunday(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The window is closed at its far end too, so a later date falls outside it.

    Nothing the API accepts writes a match ahead of today, but the sample-data
    importer builds rows straight from a CSV, and a bucket past the sixth would be
    an IndexError rather than a point off the chart.
    """
    player = make_player(db_session, coach_id=coach.id)
    make_match(
        db_session,
        player_id=player.id,
        played_on=_in_week(5) + timedelta(weeks=1),
        result=MatchResult.WIN,
    )

    assert _values(client, "record") == [None] * 6


def test_squad_trend_leaves_an_unresulted_week_null(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Matches logged without a result decided nothing, so the win rate is absent."""
    player = make_player(db_session, coach_id=coach.id)
    make_match(db_session, player_id=player.id, played_on=_in_week(5))

    assert _values(client, "record") == [None] * 6


def test_squad_trend_pools_the_roster_and_nobody_elses(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One win and one loss in the same week puts the squad at 50% for it.

    Another coach's player wins that week too, which would read 67% if counted.
    """
    for result in [MatchResult.WIN, MatchResult.LOSS]:
        make_match(
            db_session,
            player_id=make_player(db_session, coach_id=coach.id).id,
            played_on=_in_week(5),
            result=result,
        )
    make_match(
        db_session,
        player_id=make_player(db_session).id,
        played_on=_in_week(5),
        result=MatchResult.WIN,
    )

    assert _values(client, "record") == [None, None, None, None, None, 50]


def test_squad_trend_pools_a_weeks_points_rather_than_its_players(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Four forced to one beside two to two is 6:3, so 2.0 where the mean is 2.5."""
    for forced, mistake in [(4, 1), (2, 2)]:
        _captured_match(
            db_session,
            make_player(db_session, coach_id=coach.id).id,
            _in_week(3),
            forced=forced,
            mistake=mistake,
        )

    assert _values(client, "forced_to_unforced") == [None, None, None, 2.0, None, None]


def test_squad_trend_has_no_stand_in_for_a_missing_denominator(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A week of clean tennis has no ratio to draw, where a member row shows the count."""
    player = make_player(db_session, coach_id=coach.id)
    _captured_match(db_session, player.id, _in_week(2), forced=3)

    assert _values(client, "forced_to_unforced") == [None] * 6


def test_squad_trend_first_serve_pools_the_weeks_serves(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Six of ten beside one of four is 7 of 14, so 50% and not the 42.5% mean."""
    for first_in, faults in [(6, 4), (1, 3)]:
        _captured_match(
            db_session,
            make_player(db_session, coach_id=coach.id).id,
            _in_week(1),
            first_in=first_in,
            faults=faults,
        )

    assert _values(client, "first_serve_in") == [None, 50, None, None, None, None]


# --- the surface axis, squad side (#225) ---


def test_squad_members_narrows_by_surface_and_zeroes_a_player_with_none(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One player with a hard-court win, another with only a clay match this year.

    The hard filter counts the first player's period record over that one match and
    zeroes the second rather than dropping them from the roster — the same "every
    roster row answers" rule the no-matches-at-all case already follows.
    """
    hard_player = make_player(db_session, coach_id=coach.id, last_name="Abbott")
    clay_only_player = make_player(db_session, coach_id=coach.id, last_name="Zubair")
    make_match(
        db_session,
        player_id=hard_player.id,
        surface=Surface.HARD,
        played_on=date(THIS_YEAR, 7, 1),
        result=MatchResult.WIN,
    )
    make_match(
        db_session,
        player_id=clay_only_player.id,
        surface=Surface.CLAY,
        played_on=date(THIS_YEAR, 7, 1),
        result=MatchResult.WIN,
    )

    body = _squad(client, surface="hard")

    assert [row["player_id"] for row in body] == [str(hard_player.id), str(clay_only_player.id)]
    assert body[0]["period_record"] == {"wins": 1, "losses": 0}
    assert body[0]["matches_logged_this_period"] == 1
    assert body[1]["period_record"] == {"wins": 0, "losses": 0}
    assert body[1]["matches_logged_this_period"] == 0


def test_squad_trend_narrows_by_surface(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A hard-court win and a same-week clay loss; the hard filter counts only the win."""
    player = make_player(db_session, coach_id=coach.id)
    make_match(
        db_session,
        player_id=player.id,
        surface=Surface.HARD,
        played_on=_in_week(5),
        result=MatchResult.WIN,
    )
    make_match(
        db_session,
        player_id=player.id,
        surface=Surface.CLAY,
        played_on=_in_week(5, 1),
        result=MatchResult.LOSS,
    )

    response = client.get(TREND_PATH, params={"metric": "record", "surface": "hard"})

    assert response.status_code == 200
    assert response.json()[-1]["value"] == 100


# --- the player principal ---
#
# The six routes above answer a player session about itself, so the figures a coach
# reads are the ones the player reads. The squad snapshot is roster-wide and stays
# coach-only.


@pytest.fixture
def signed_in_player(client: TestClient, db_session: Session) -> Player:
    """The player the client is signed in as, on a roster the factory mints with them."""
    player = make_player(db_session)
    sign_in_player(client, db_session, player)
    return player


@pytest.mark.parametrize("suffix", ENDPOINTS)
def test_routes_answer_a_player_about_itself(
    client: TestClient, db_session: Session, signed_in_player: Player, suffix: str
) -> None:
    """A real match with a point on it, so each tab answers over rows rather than
    over the empty case every endpoint shares."""
    match = make_match(db_session, player_id=signed_in_player.id, opponent_name="Torres")
    make_point(db_session, match_id=match.id)
    db_session.commit()

    assert _get(client, signed_in_player.id, suffix) is not None


@pytest.mark.parametrize("suffix", ENDPOINTS)
def test_routes_hide_a_stablemate_from_a_player(
    client: TestClient, db_session: Session, signed_in_player: Player, suffix: str
) -> None:
    """Same coach, so the coach-scoped check these routes used to make would have
    answered: the player principal is refused by the same 404 an outsider gets."""
    stablemate = make_player(db_session, coach_id=signed_in_player.coach_id)
    db_session.commit()

    response = client.get(f"/players/{stablemate.id}/analytics/{suffix}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Player not found"


@pytest.mark.parametrize("suffix", MATCH_ENDPOINTS)
def test_match_routes_answer_a_player_about_their_own_match(
    client: TestClient, db_session: Session, signed_in_player: Player, suffix: str
) -> None:
    match = make_match(db_session, player_id=signed_in_player.id)
    make_point(db_session, match_id=match.id)
    db_session.commit()

    assert _get_match(client, match.id, suffix) is not None


@pytest.mark.parametrize("suffix", MATCH_ENDPOINTS)
def test_match_routes_hide_a_stablemates_match_from_a_player(
    client: TestClient, db_session: Session, signed_in_player: Player, suffix: str
) -> None:
    stablemate = make_player(db_session, coach_id=signed_in_player.coach_id)
    theirs = make_match(db_session, player_id=stablemate.id)
    db_session.commit()

    response = client.get(f"/matches/{theirs.id}/analytics/{suffix}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Match not found"


@pytest.mark.parametrize("path", [SQUAD_PATH, TREND_PATH])
@pytest.mark.usefixtures("signed_in_player")
def test_squad_routes_refuse_a_player(client: TestClient, path: str) -> None:
    """Roster-wide by definition, so they stay coach-only: a player session carries
    no coach cookie and takes the 401 no session takes."""
    response = client.get(path, params={"metric": "record"})

    assert response.status_code == 401
