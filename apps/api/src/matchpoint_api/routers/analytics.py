import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from itertools import chain, takewhile
from statistics import fmean, pstdev
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Row, and_, distinct, func, select, tuple_
from sqlalchemy.orm import Session

from matchpoint_api.auth import CurrentCoach
from matchpoint_api.db import get_db
from matchpoint_api.models import (
    EndReason,
    FailureMode,
    Match,
    MatchResult,
    MatchSide,
    Player,
    Point,
    RallyBucket,
    ReturnOutcome,
    ServeOutcome,
    ShotType,
    Surface,
    UnusualReason,
    Wing,
)
from matchpoint_api.routers.matches import match_for_coach
from matchpoint_api.routers.players import owned_player
from matchpoint_api.schemas.analytics import (
    BreakdownRow,
    CourtZoneCount,
    CurrentStreak,
    FaultModeShares,
    FaultModeSplit,
    Metric,
    MetricUnit,
    OpponentSummary,
    OutcomeMixRow,
    PlayerOverview,
    PointEnderKind,
    PointEnderStyle,
    PointEnderStyleDetail,
    PointEnderStyles,
    PointPhase,
    RallyLengthBucket,
    RallyStats,
    ReturnOutcomeSplit,
    ServeOutcomeShares,
    ServeOutcomeSplit,
    ServeSideStats,
    ServeStats,
    ServeTrendPoint,
    ShotFrequencySides,
    ShotShare,
    SquadMemberStats,
    SquadMetric,
    SquadTrendPoint,
    TrackedStat,
    TrackedStatKey,
    WingSplit,
    WinLossRecord,
)
from matchpoint_api.schemas.errors import ErrorDetail

# The 401 is declared once at the router because every route here requires a signed-in
# coach, as on the player routes; the 429 is the per-coach budget current_coach
# charges. Every endpoint is a read over rows the ingest endpoint already validated,
# so nothing here writes, and the ownership 404 stays undeclared as everywhere else.
router = APIRouter(
    prefix="/players/{player_id}/analytics",
    tags=["analytics"],
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)

# The per-match tabs are the player's own two tabs scoped to one match, so they answer
# in the same shapes and differ only in how ownership is reached and what the points
# are filtered to. A route of their own rather than a match_id parameter on the player
# routes, which would have to answer for a match belonging to some other player.
match_router = APIRouter(
    prefix="/matches/{match_id}/analytics",
    tags=["analytics"],
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)

# The squad snapshot (#204) is the whole roster at once rather than one player, so it
# cannot hang off either prefix above. Same tag and same declared responses: it is the
# same read, over every player the coach owns.
squad_router = APIRouter(
    prefix="/squad/analytics",
    tags=["analytics"],
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)

DbSession = Annotated[Session, Depends(get_db)]

# Five is the deepest set number any system in docs/scoring-systems.md reaches, the
# men's Grand Slam format being best-of-five; every other system decides in three or
# fewer. Ingest stores whatever set the client stamps, so this bound is the filter's
# own and not a claim about what the table holds.
MAX_SET_NUMBER = 5

SetFilter = Annotated[
    int | None, Query(ge=1, le=MAX_SET_NUMBER, description="Count only points from this set.")
]
PhaseFilter = Annotated[
    PointPhase, Query(description="Count only points the capture client stamped as this moment.")
]
OpponentFilter = Annotated[
    str | None,
    # Bounded so a blank key is a 422 rather than the 404 an unknown one earns: the
    # picker sends "all opponents" by omitting the parameter, and a `<select>` whose
    # all option carries "" is a wiring bug the spec can name before a request goes out.
    Query(
        min_length=1,
        description="Count only matches against this opponent, keyed as `/opponents` returns.",
    ),
]
SurfaceFilter = Annotated[
    Surface | None, Query(description="Count only matches played on this surface (#225).")
]

# A key no match answers to is declared because the client can act on it: a picker
# option outlives the matches that put it there, so a stale key sends the panel back
# to all matches, where a tab quietly counting nothing would read as a bad season.
OPPONENT_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorDetail, "description": "No matches against this opponent"}
}

# Bars need a ceiling even where a rate has no natural one; these match the scale the
# dashboard was designed against, and a value past one simply becomes its own ceiling.
DOUBLE_FAULT_CAP = 5.0
ACES_CAP = 6.0
RATIO_CAP = 3.0

FORCED_UNFORCED_LABEL = "Forced : Unforced ratio"
FIRST_SERVE_IN_LABEL = "1st serve in %"

# How many matches the serve trend line carries. Six because the chart draws its
# match labels at 9px on a phone, and a longer season would crowd them into each
# other rather than say anything more about recent form.
SERVE_TREND_MATCHES = 6

# The baseline a squad-snapshot tracked stat's latest value is judged against: the ten
# matches before it. Wide enough that one match cannot set the deviation on its own,
# recent enough to still be normal.
BASELINE_MATCHES = 10

# The fewest points of its own kind a match must record before a tracked stat takes a
# value from it: below ten, a proportion moves in steps of more than ten points of
# percentage, and a figure that coarse only widens the deviation the client divides by.
MIN_POINTS_FOR_TRACKED_STAT = 10

_SHOT_LABEL = {
    ShotType.DRIVE: "drive",
    ShotType.VOLLEY: "volley",
    ShotType.DROPSHOT: "drop shot",
    ShotType.LOB: "lob",
}

# Which point-ender card an end reason lands on. Aces and double faults are missing
# on purpose: a serve settled them, so they are counted on the serve tab instead.
_POINT_ENDER_KIND = {
    EndReason.FORCED: PointEnderKind.FORCED,
    EndReason.MISTAKE: PointEnderKind.UNFORCED,
    EndReason.UNUSUAL: PointEnderKind.UNUSUAL,
}

# Each label names whose pressure or whose error decided the point, so the wording
# swaps with the side. Keyed on whether the tracked player won it.
_POINT_ENDER_LABEL = {
    (True, PointEnderKind.FORCED): "Forced (your pressure)",
    (True, PointEnderKind.UNFORCED): "Unforced (their free error)",
    (True, PointEnderKind.UNUSUAL): "Unusual (in your favor)",
    (False, PointEnderKind.FORCED): "Forced (their pressure)",
    (False, PointEnderKind.UNFORCED): "Unforced (your free error)",
    (False, PointEnderKind.UNUSUAL): "Unusual (against you)",
}

# The seven zones a final ball can land in, in the order the court diagram reads
# them: each half from the net outward, then the three ways a ball goes out.
COURT_ZONES = (
    "Deuce short",
    "Deuce deep",
    "Ad short",
    "Ad deep",
    "Net",
    "Long",
    "Wide",
)


# Short where the returning card's own breakdown spells the same four outcomes out in
# full: these label the bars inside the 1st/2nd serve drill-down, where the heading
# already says they are returns and the column is a phone's width.
_RETURN_OUTCOME_LABEL = {
    ReturnOutcome.IN: "In",
    ReturnOutcome.NET: "Net",
    ReturnOutcome.LONG: "Long",
    ReturnOutcome.WIDE: "Wide",
}

# The shot range each stored bucket stands for. Capture stores b1..b4 and nothing
# about their bounds (#175), so the ranges are settled here, matching the ones the
# rally tab's histogram is already captioned with.
_RALLY_LENGTH_LABEL = {
    RallyBucket.B1: "1–3 shots",
    RallyBucket.B2: "4–6 shots",
    RallyBucket.B3: "7–9 shots",
    RallyBucket.B4: "10+ shots",
}


def _percent(
    label: str,
    part: int,
    whole: int,
    *,
    sample: str | None = None,
    higher_is_better: bool = True,
    baseline: float | None = None,
    delta: float | None = None,
) -> Metric | None:
    """A percentage metric, or None while nothing has been counted to take one of."""
    if whole == 0:
        return None
    return Metric(
        label=label,
        value=round(100 * part / whole),
        unit=MetricUnit.PERCENT,
        sample_size=sample if sample is not None else f"n={whole}",
        baseline=baseline,
        delta=delta,
        max=100,
        higher_is_better=higher_is_better,
    )


def _per(
    label: str,
    count: int,
    denominator: int,
    *,
    unit: MetricUnit,
    cap: float,
    sample: str,
    higher_is_better: bool = False,
) -> Metric | None:
    """A per-set or per-match rate, or None while the denominator is empty."""
    if denominator == 0:
        return None
    value = round(count / denominator, 1)
    return Metric(
        label=label,
        value=value,
        unit=unit,
        sample_size=sample,
        baseline=None,
        delta=None,
        max=max(cap, value),
        higher_is_better=higher_is_better,
    )


def _ratio_value(forced: int, unforced: int) -> float | None:
    """The forced : unforced ratio as a bare number, or None with neither counted.

    With no unforced errors at all the true ratio has no value, so the forced count
    stands in for it, which is what the "4:0" display below says out loud.
    """
    if forced + unforced == 0:
        return None
    if unforced == 0:
        return float(forced)
    return round(forced / unforced, 2)


def _forced_unforced(
    forced: int, unforced: int, *, baseline: float | None = None, delta: float | None = None
) -> Metric | None:
    """The forced : unforced ratio as a metric, or None while no rally has ended.

    With no unforced errors the count itself is shown ("4:0") while the bar fills to
    its ceiling.
    """
    value = _ratio_value(forced, unforced)
    if value is None:
        return None
    if unforced == 0:
        display = f"{forced}:0"
        ceiling = value
    else:
        display = None
        ceiling = max(RATIO_CAP, value)
    return Metric(
        label=FORCED_UNFORCED_LABEL,
        value=value,
        unit=MetricUnit.RATIO,
        sample_size=f"n={forced + unforced}",
        baseline=baseline,
        delta=delta,
        max=ceiling,
        higher_is_better=True,
        display=display,
    )


# Every phase a caller can ask for is a boolean the capture client already stamped on
# the point (#175), so narrowing to one is a column test and never a replay of the
# score. PointPhase.FULL is absent because it narrows nothing.
_PHASE_COLUMN: dict[PointPhase, Any] = {
    PointPhase.TIEBREAKS: Point.in_tiebreak,
    PointPhase.BREAK_POINTS: Point.is_break_point,
    PointPhase.GAME_POINTS: Point.is_game_point,
    PointPhase.SET_POINTS: Point.is_set_point,
    PointPhase.MATCH_POINTS: Point.is_match_point,
    PointPhase.GAME_ENDING: Point.is_game_end,
    PointPhase.SET_ENDING: Point.is_set_end,
}


@dataclass(frozen=True)
class PointScope:
    """Which of a player's points a figure is computed over, on every axis at once.

    One object rather than a parameter per axis: each helper below aggregates points
    and every one of them must narrow by the same rule, or a filtered headline ends
    up sitting beside an unfiltered breakdown.
    """

    # None means every match the player has, which is what the unfiltered tabs ask for.
    match_ids: Sequence[uuid.UUID] | None = None
    set_number: int | None = None
    phase: PointPhase = PointPhase.FULL

    def conditions(self) -> list[Any]:
        """The `points` terms this scope adds, empty where it narrows nothing."""
        terms: list[Any] = []
        if self.match_ids is not None:
            terms.append(Point.match_id.in_(self.match_ids))
        if self.set_number is not None:
            terms.append(Point.set_number == self.set_number)
        if self.phase is not PointPhase.FULL:
            terms.append(_PHASE_COLUMN[self.phase])
        return terms


def _point_counts(db: Session, player_id: uuid.UUID, scope: PointScope) -> Row[Any]:
    """Every point tally the endpoints aggregate over, in one FILTER query.

    A superset on purpose: one shape whatever the endpoint, so the arithmetic on top
    is the only thing that differs and the query is exercised whole by every test.
    Aggregating over no rows still returns one row of zero counts, and the per-set and
    per-match denominators are counted off the scoped rows so they stay in step.
    """

    # Conditions are Any because a bare boolean column (Point.won) arrives as an
    # InstrumentedAttribute, which and_() accepts but ColumnElement doesn't admit.
    def _count(*conditions: Any) -> Any:
        return func.count().filter(and_(*conditions))

    tracked = Point.server == MatchSide.TRACKED
    opponent = Point.server == MatchSide.OPPONENT
    first_in = Point.serve1_outcome != ServeOutcome.FAULT
    second = Point.serve1_outcome == ServeOutcome.FAULT
    # Tiebreak points are excluded from game tallies: the players alternate serve
    # inside one, so its final point says nothing about anyone holding.
    game = and_(Point.is_game_end, ~Point.in_tiebreak)
    forced = Point.end_reason == EndReason.FORCED
    mistake = Point.end_reason == EndReason.MISTAKE

    statement = (
        select(
            func.count().label("total"),
            _count(Point.won).label("won"),
            _count(game, tracked).label("hold_games"),
            _count(game, tracked, Point.won).label("hold_won"),
            _count(game, opponent).label("return_games"),
            _count(game, opponent, Point.won).label("return_won"),
            _count(tracked).label("serve_points"),
            _count(tracked, first_in).label("first_in"),
            _count(tracked, first_in, Point.won).label("first_in_won"),
            _count(tracked, second).label("second_points"),
            _count(tracked, second, Point.won).label("second_won"),
            _count(tracked, Point.is_break_point).label("bp_faced"),
            _count(tracked, Point.is_break_point, Point.won).label("bp_saved"),
            _count(tracked, Point.end_reason == EndReason.DOUBLE_FAULT).label("double_faults"),
            _count(tracked, Point.end_reason == EndReason.ACE).label("aces"),
            _count(tracked, Point.won, Point.wing == Wing.FOREHAND).label("forehand_wins"),
            _count(tracked, Point.won, Point.wing == Wing.BACKHAND).label("backhand_wins"),
            _count(opponent).label("return_points"),
            _count(opponent, first_in).label("their_first_in"),
            _count(opponent, first_in, Point.won).label("their_first_in_won"),
            _count(opponent, second).label("their_second"),
            _count(opponent, second, Point.won).label("their_second_won"),
            _count(opponent, Point.is_break_point).label("bp_chances"),
            _count(opponent, Point.is_break_point, Point.won).label("bp_converted"),
            _count(opponent, Point.end_reason == EndReason.ACE).label("their_aces"),
            _count(Point.won, forced).label("forced_won"),
            _count(Point.won, mistake).label("mistake_won"),
            _count(~Point.won, forced).label("forced_lost"),
            _count(~Point.won, mistake).label("mistake_lost"),
            _count(Point.is_break_point, ~Point.won, mistake).label("bp_mistakes"),
            _count(Point.is_break_point).label("bp_points"),
            *(
                _count(Point.rally_length_bucket == bucket).label(f"rally_{bucket.value}")
                for bucket in RallyBucket
            ),
            func.count(distinct(tuple_(Point.match_id, Point.set_number))).label("sets_played"),
            func.count(distinct(Point.match_id)).label("matches_with_points"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(Match.player_id == player_id, *scope.conditions())
    )
    return db.execute(statement).one()


def _shot_breakdowns(
    db: Session, player_id: uuid.UUID, scope: PointScope
) -> tuple[list[BreakdownRow], list[BreakdownRow], ShotFrequencySides]:
    """The by-final-shot bars for wins and losses, plus the radar's shares.

    The stored shot is the last successful one (#175): on a win it is the player's
    own, so the win rows and the radar's `you` describe the player; on a loss it is
    the opponent's, so the loss rows and `opponents` describe the shots points were
    lost to, the loss rows splitting the player's unforced errors after them (value)
    from being beaten outright (secondary_value).
    """
    statement = (
        select(
            Point.won,
            Point.wing,
            Point.shot_type,
            func.count().filter(Point.end_reason == EndReason.MISTAKE).label("mistakes"),
            func.count().filter(Point.end_reason == EndReason.FORCED).label("forced"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(Match.player_id == player_id, Point.wing.is_not(None), *scope.conditions())
        .group_by(Point.won, Point.wing, Point.shot_type)
    )
    rows = db.execute(statement).all()

    won_rows = [row for row in rows if row.won]
    lost_rows = [row for row in rows if not row.won]

    won_max = max((row.mistakes + row.forced for row in won_rows), default=0)
    won_by_shot = sorted(
        (
            BreakdownRow(
                label=_shot_row_label(row.wing, row.shot_type),
                value=row.mistakes + row.forced,
                max=won_max,
            )
            for row in won_rows
        ),
        key=lambda row: (-row.value, row.label),
    )
    lost_max = max((row.mistakes + row.forced for row in lost_rows), default=0)
    lost_by_shot = sorted(
        (
            BreakdownRow(
                label=_shot_row_label(row.wing, row.shot_type),
                value=row.mistakes,
                secondary_value=row.forced,
                max=lost_max,
            )
            for row in lost_rows
        ),
        key=lambda row: (-(row.value + (row.secondary_value or 0)), row.label),
    )

    shot_frequency = ShotFrequencySides(
        you=_shot_shares(won_rows), opponents=_shot_shares(lost_rows)
    )
    return won_by_shot, lost_by_shot, shot_frequency


def _shot_shares(rows: Sequence[Row[Any]]) -> list[ShotShare]:
    """One side's point-ending shots as shares of its own total, or nothing yet."""
    total = sum(row.mistakes + row.forced for row in rows)
    if not total:
        return []
    by_type = {shot: 0 for shot in ShotType}
    for row in rows:
        by_type[row.shot_type] += row.mistakes + row.forced
    return [
        ShotShare(shot=_SHOT_LABEL[shot].capitalize(), share=round(count / total, 2))
        for shot, count in by_type.items()
    ]


def _shot_row_label(wing: Wing, shot_type: ShotType) -> str:
    return f"{wing.value.capitalize()} {_SHOT_LABEL[shot_type]}"


def _results_newest_first(db: Session, player_id: uuid.UUID) -> list[Row[Any]]:
    """The player's matches that carry a result, newest first.

    Only those feed win/loss arithmetic: a match whose result was never recorded has
    no side to count for, however much else is known about it.
    """
    return list(
        db.execute(
            select(Match.id, Match.result, Match.played_on, Match.opponent_name)
            .where(Match.player_id == player_id, Match.result.is_not(None))
            .order_by(Match.played_on.desc(), Match.created_at.desc())
        )
    )


def _wins(results: Sequence[Row[Any]]) -> int:
    return sum(row.result == MatchResult.WIN for row in results)


def _form_metric(results: Sequence[Row[Any]]) -> Metric | None:
    """Win percentage over the last five results, judged against all time.

    The delta compares the five before those, and stays null until they exist whole:
    a partial previous window would make early swings look like trends.
    """
    window, previous = results[:5], results[5:10]
    baseline = _percent("", _wins(results), len(results))
    current = _percent(
        "Form (win % last 5)",
        _wins(window),
        len(window),
        baseline=baseline.value if baseline else None,
    )
    if current is not None and len(previous) == 5:
        current.delta = current.value - round(100 * _wins(previous) / len(previous))
    return current


def _normalised(opponent_name: str) -> str:
    return opponent_name.strip().lower()


def _matches_by_opponent(db: Session, player_id: uuid.UUID) -> dict[str, list[Row[Any]]]:
    """The player's named-opponent matches grouped by matchup key, newest first.

    Free text is the whole identity (#172): opponents are rarely in the coach's
    roster, so the trimmed lowercase name is the matchup key, and a typo splitting
    one opponent in two is the accepted cost. `surface` rides along unfiltered so a
    surface-narrowed opponent lookup (`_scoped_matches` below) has it to filter on
    without a second query.
    """
    groups: dict[str, list[Row[Any]]] = {}
    for row in db.execute(
        select(Match.id, Match.result, Match.played_on, Match.opponent_name, Match.surface)
        .where(Match.player_id == player_id, Match.opponent_name.is_not(None))
        .order_by(Match.played_on.desc(), Match.created_at.desc())
    ):
        groups.setdefault(_normalised(row.opponent_name), []).append(row)
    return groups


def _opponent_matches(
    db: Session, player_id: uuid.UUID, opponent_key: str | None
) -> list[Row[Any]] | None:
    """The player's matches against one opponent, or None where none was named.

    The incoming key is normalised again so a caller may send a name as the coach
    spelled it, and an unmatched one is the refusal `OPPONENT_NOT_FOUND` declares.
    """
    if opponent_key is None:
        return None
    matches = _matches_by_opponent(db, player_id).get(_normalised(opponent_key))
    if matches is None:
        raise HTTPException(status_code=404, detail="No matches against this opponent")
    return matches


def _surface_matches(db: Session, player_id: uuid.UUID, surface: Surface) -> list[Row[Any]]:
    """The player's matches on one surface, named opponent or not (#225).

    A separate query from `_matches_by_opponent` on purpose: that one only ever
    selects matches carrying an opponent name, and reusing it for a surface-only
    filter would silently drop every nameless match.
    """
    return list(
        db.execute(
            select(Match.id, Match.result, Match.played_on, Match.opponent_name)
            .where(Match.player_id == player_id, Match.surface == surface)
            .order_by(Match.played_on.desc(), Match.created_at.desc())
        )
    )


def _scoped_matches(
    db: Session, player_id: uuid.UUID, opponent_key: str | None, surface: Surface | None
) -> list[Row[Any]] | None:
    """The player's matches narrowed by whichever of the opponent/surface axes are set.

    None only where neither axis is set, the unfiltered tabs' own sentinel for "every
    match". The opponent key is resolved first, so an unknown one still raises
    `OPPONENT_NOT_FOUND` before surface gets a say — a real opponent with no matches
    on the requested surface is an empty payload, not a 404.
    """
    opponent_matches = _opponent_matches(db, player_id, opponent_key)
    if opponent_matches is not None:
        if surface is None:
            return opponent_matches
        return [row for row in opponent_matches if row.surface == surface]
    if surface is not None:
        return _surface_matches(db, player_id, surface)
    return None


def _player_scope(
    db: Session,
    player_id: uuid.UUID,
    opponent_key: str | None,
    set_number: int | None,
    phase: PointPhase,
    surface: Surface | None = None,
) -> PointScope:
    """The four axes the stats scope panel commits at once, as one scope (#244, #225)."""
    matches = _scoped_matches(db, player_id, opponent_key, surface)
    return PointScope(
        match_ids=None if matches is None else [row.id for row in matches],
        set_number=set_number,
        phase=phase,
    )


@router.get("/opponents", response_model=list[OpponentSummary])
def list_opponents(
    player_id: uuid.UUID, db: DbSession, coach: CurrentCoach, surface: SurfaceFilter = None
) -> list[OpponentSummary]:
    """Every opponent this player has met, most-met first, then by key.

    What the scope panel's picker offers, so each row's key is exactly what the tabs
    take back as `opponent_key`. Ordered on the key rather than the display name
    because it is the one spelling of a matchup that cannot vary. `surface`, if given,
    narrows the count to that surface (#225), so the picker's own numbers describe
    the scope a coach is about to apply rather than the whole career; an opponent with
    no matches on that surface is dropped rather than shown at zero, since it is not a
    real option to pick.
    """
    owned_player(db, player_id, coach.id)
    summaries: list[OpponentSummary] = []
    for key, matches in _matches_by_opponent(db, player_id).items():
        on_surface = (
            matches if surface is None else [row for row in matches if row.surface == surface]
        )
        if not on_surface:
            continue
        # The group is newest first, so its first row carries the latest spelling.
        summaries.append(
            OpponentSummary(key=key, name=matches[0].opponent_name, matches=len(on_surface))
        )
    return sorted(summaries, key=lambda summary: (-summary.matches, summary.key))


@router.get("/overview", response_model=PlayerOverview, responses=OPPONENT_NOT_FOUND)
def get_player_overview(
    player_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    opponent_key: OpponentFilter = None,
    surface: SurfaceFilter = None,
) -> PlayerOverview:
    """The overview tab: form, the headline rates, and the win/loss record.

    Takes the opponent and surface axes and not the set or phase one (#227, #244,
    #225): both narrow matches, which all seven fields are counted over one way or
    the other, where a set or a phase could reach only the three counted over points.
    """
    owned_player(db, player_id, coach.id)
    matches = _scoped_matches(db, player_id, opponent_key, surface)
    if matches is None:
        results = _results_newest_first(db, player_id)
        scope = PointScope()
    else:
        results = [row for row in matches if row.result is not None]
        scope = PointScope(match_ids=[row.id for row in matches])
    counts = _point_counts(db, player_id, scope)

    this_year = [row for row in results if row.played_on.year == date.today().year]
    recent = results[:5]
    return PlayerOverview(
        form=_form_metric(results),
        recent_results=[row.result for row in reversed(recent)],
        hold_percentage=_percent("Hold %", counts.hold_won, counts.hold_games),
        return_games_won=_percent("Return games won %", counts.return_won, counts.return_games),
        forced_to_unforced=_forced_unforced(counts.forced_won, counts.mistake_lost),
        season_record=WinLossRecord(
            wins=_wins(this_year), losses=len(this_year) - _wins(this_year)
        ),
        all_time_record=WinLossRecord(wins=_wins(results), losses=len(results) - _wins(results)),
    )


def _fault_shares(faults: Counter[FailureMode]) -> FaultModeShares | None:
    """The three ways a serve misses, as percentages, or None while none has."""
    total = sum(faults.values())
    if total == 0:
        return None
    return FaultModeShares(
        net=round(100 * faults[FailureMode.NET] / total),
        long=round(100 * faults[FailureMode.LONG] / total),
        wide=round(100 * faults[FailureMode.WIDE] / total),
    )


def _fault_modes(db: Session, player_id: uuid.UUID, scope: PointScope) -> FaultModeSplit:
    """How the player's own faulted serves missed, per serve number.

    Their own alone: capture records no placement for a serve the opponent hit
    (`schemas/point.py`), so the returning side has none of this to show.
    """
    statement = (
        select(
            Point.serve1_fault_mode,
            Point.serve2_fault_mode,
            func.count().label("points"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(Match.player_id == player_id, Point.server == MatchSide.TRACKED, *scope.conditions())
        .group_by(Point.serve1_fault_mode, Point.serve2_fault_mode)
    )

    first: Counter[FailureMode] = Counter()
    second: Counter[FailureMode] = Counter()
    for row in db.execute(statement):
        if row.serve1_fault_mode is not None:
            first[row.serve1_fault_mode] += row.points
        if row.serve2_fault_mode is not None:
            second[row.serve2_fault_mode] += row.points
    return FaultModeSplit(first_serve=_fault_shares(first), second_serve=_fault_shares(second))


def _serve_shares(outcomes: Counter[ServeOutcome]) -> ServeOutcomeShares | None:
    """One serve number's three outcomes as percentages, or None if never attempted.

    The in share is taken ace-inclusive and the ace share subtracted out of it, so the
    three total exactly 100 and `landed + ace` is the same number as the "1st serve
    in %" metric on the same card.
    """
    total = sum(outcomes.values())
    if total == 0:
        return None
    served_in = round(100 * (outcomes[ServeOutcome.IN] + outcomes[ServeOutcome.ACE]) / total)
    ace = round(100 * outcomes[ServeOutcome.ACE] / total)
    return ServeOutcomeShares(landed=served_in - ace, fault=100 - served_in, ace=ace)


def _serve_outcomes(
    db: Session, player_id: uuid.UUID, scope: PointScope
) -> dict[MatchSide, ServeOutcomeSplit]:
    """Both sides' serve outcomes, split by serve number.

    Read off the serve columns rather than off end_reason: an ace is a property of the
    serve, and only these columns say which attempt it was.
    """
    statement = (
        select(
            Point.server,
            Point.serve1_outcome,
            Point.serve2_outcome,
            func.count().label("points"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(Match.player_id == player_id, *scope.conditions())
        .group_by(Point.server, Point.serve1_outcome, Point.serve2_outcome)
    )

    first: dict[MatchSide, Counter[ServeOutcome]] = {side: Counter() for side in MatchSide}
    second: dict[MatchSide, Counter[ServeOutcome]] = {side: Counter() for side in MatchSide}
    for row in db.execute(statement):
        first[row.server][row.serve1_outcome] += row.points
        if row.serve2_outcome is not None:
            second[row.server][row.serve2_outcome] += row.points
    return {
        side: ServeOutcomeSplit(
            first_serve=_serve_shares(first[side]), second_serve=_serve_shares(second[side])
        )
        for side in MatchSide
    }


def _return_rows(outcomes: Counter[ReturnOutcome]) -> list[BreakdownRow]:
    """Every return outcome as a percentage bar, or nothing until one is recorded."""
    total = sum(outcomes.values())
    if total == 0:
        return []
    return [
        BreakdownRow(label=label, value=round(100 * outcomes[outcome] / total), max=100)
        for outcome, label in _RETURN_OUTCOME_LABEL.items()
    ]


def _returns_by_serve(
    db: Session, player_id: uuid.UUID, scope: PointScope
) -> dict[bool, Counter[ReturnOutcome]]:
    """The player's recorded returns, counted per outcome and per serve number.

    The player's own alone: a return is recorded only on a point the opponent served
    (`schemas/point.py`). One read feeds both the card's totals and its per-serve
    bars, the bars being these same rows grouped a level finer.
    """
    second_serve = (Point.serve1_outcome == ServeOutcome.FAULT).label("second_serve")
    statement = (
        select(second_serve, Point.return_outcome, func.count().label("returned"))
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(
            Match.player_id == player_id,
            Point.server == MatchSide.OPPONENT,
            Point.return_outcome.is_not(None),
            *scope.conditions(),
        )
        .group_by(second_serve, Point.return_outcome)
    )

    by_serve: dict[bool, Counter[ReturnOutcome]] = {False: Counter(), True: Counter()}
    for row in db.execute(statement):
        by_serve[row.second_serve][row.return_outcome] += row.returned
    return by_serve


def _trend_points(rows_newest_first: Sequence[Row[Any]]) -> list[ServeTrendPoint]:
    """One side's most recent matches as trend points, relabelled oldest first."""
    window = list(reversed(rows_newest_first[:SERVE_TREND_MATCHES]))
    return [
        ServeTrendPoint(
            match=f"M{position}",
            first_serve_in=round(100 * row.first_in / row.served),
            second_serve_in=round(100 * row.second_in / row.second) if row.second else None,
        )
        for position, row in enumerate(window, start=1)
    ]


def _serve_trends(
    db: Session, player_id: uuid.UUID, scope: PointScope
) -> dict[MatchSide, list[ServeTrendPoint]]:
    """Both sides' serve-in rates, one entry per match either side served in.

    Grouped by side as well as by match, so each count is a plain condition rather
    than a filter carrying the side around with it.
    """
    second = Point.serve1_outcome == ServeOutcome.FAULT
    statement = (
        select(
            Point.server,
            func.count().label("served"),
            func.count().filter(Point.serve1_outcome != ServeOutcome.FAULT).label("first_in"),
            func.count().filter(second).label("second"),
            func.count()
            .filter(and_(second, Point.serve2_outcome != ServeOutcome.FAULT))
            .label("second_in"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(Match.player_id == player_id, *scope.conditions())
        .group_by(Point.match_id, Point.server, Match.played_on, Match.created_at)
        .order_by(Match.played_on.desc(), Match.created_at.desc())
    )

    newest_first: dict[MatchSide, list[Row[Any]]] = {side: [] for side in MatchSide}
    for row in db.execute(statement):
        newest_first[row.server].append(row)
    return {side: _trend_points(rows) for side, rows in newest_first.items()}


def _serving_stats(
    counts: Row[Any],
    outcome: ServeOutcomeSplit,
    fault_mode: FaultModeSplit,
    trend: list[ServeTrendPoint],
) -> ServeSideStats:
    sets_sample = f"n={counts.sets_played} sets"
    matches_sample = f"n={counts.matches_with_points}"
    metrics = [
        _percent("Break points saved", counts.bp_saved, counts.bp_faced),
        _percent(FIRST_SERVE_IN_LABEL, counts.first_in, counts.serve_points),
        _percent("1st serve points won", counts.first_in_won, counts.first_in),
        _percent("2nd serve points won", counts.second_won, counts.second_points),
        _per(
            "Double faults / set",
            counts.double_faults,
            counts.sets_played,
            unit=MetricUnit.PER_SET,
            cap=DOUBLE_FAULT_CAP,
            sample=sets_sample,
        ),
        _per(
            "Aces / match",
            counts.aces,
            counts.matches_with_points,
            unit=MetricUnit.PER_MATCH,
            cap=ACES_CAP,
            sample=matches_sample,
            higher_is_better=True,
        ),
    ]
    breakdown = []
    if counts.serve_points:
        # How the player's own service points were won or thrown away: the wing each
        # win ended on, alongside the two endings a serve produces on its own. Rally
        # losses on serve belong to the rally tab, where the shot that took them is named.
        values = {
            "Aces": counts.aces,
            "Won on forehand": counts.forehand_wins,
            "Won on backhand": counts.backhand_wins,
            "Double faults": counts.double_faults,
        }
        ceiling = max(values.values())
        breakdown = [
            BreakdownRow(label=label, value=value, max=ceiling) for label, value in values.items()
        ]
    return ServeSideStats(
        hero=_percent("Hold % (service games won)", counts.hold_won, counts.hold_games),
        metrics=[metric for metric in metrics if metric is not None],
        breakdown=breakdown,
        outcome=outcome,
        fault_mode=fault_mode,
        # Empty rather than zeroed, for the mirror of the reason the returning card
        # has no fault modes: the opponent's return of the player's serve is not
        # captured at all.
        return_outcome=ReturnOutcomeSplit(first_serve=[], second_serve=[]),
        trend=trend,
    )


def _returning_stats(
    db: Session,
    player_id: uuid.UUID,
    counts: Row[Any],
    outcome: ServeOutcomeSplit,
    trend: list[ServeTrendPoint],
    scope: PointScope,
) -> ServeSideStats:
    metrics = [
        _percent("Break points converted", counts.bp_converted, counts.bp_chances),
        _percent("1st serve return points won", counts.their_first_in_won, counts.their_first_in),
        _percent("2nd serve return points won", counts.their_second_won, counts.their_second),
    ]
    returns = _returns_by_serve(db, player_id, scope)
    breakdown = []
    if counts.return_points:
        totals = returns[False] + returns[True]
        values = {
            "Returned in": totals[ReturnOutcome.IN],
            "Return error (net)": totals[ReturnOutcome.NET],
            "Return error (long)": totals[ReturnOutcome.LONG],
            "Return error (wide)": totals[ReturnOutcome.WIDE],
        }
        ceiling = max(values.values())
        breakdown = [
            BreakdownRow(label=label, value=value, max=ceiling) for label, value in values.items()
        ]
    return ServeSideStats(
        hero=_percent("Return games won %", counts.return_won, counts.return_games),
        metrics=[metric for metric in metrics if metric is not None],
        breakdown=breakdown,
        outcome=outcome,
        # Empty rather than zeroed: the opponent's serve is captured as in or
        # faulted and never placed, so there is no direction here to be wrong about.
        fault_mode=FaultModeSplit(first_serve=None, second_serve=None),
        return_outcome=ReturnOutcomeSplit(
            first_serve=_return_rows(returns[False]), second_serve=_return_rows(returns[True])
        ),
        trend=trend,
    )


def _serve_tab(db: Session, player_id: uuid.UUID, scope: PointScope) -> ServeStats:
    """The serve tab over whichever of the player's matches the caller scoped to."""
    counts = _point_counts(db, player_id, scope)
    trends = _serve_trends(db, player_id, scope)
    outcomes = _serve_outcomes(db, player_id, scope)
    return ServeStats(
        serving=_serving_stats(
            counts,
            outcomes[MatchSide.TRACKED],
            _fault_modes(db, player_id, scope),
            trends[MatchSide.TRACKED],
        ),
        returning=_returning_stats(
            db,
            player_id,
            counts,
            outcomes[MatchSide.OPPONENT],
            trends[MatchSide.OPPONENT],
            scope,
        ),
    )


@router.get("/serve", response_model=ServeStats, responses=OPPONENT_NOT_FOUND)
def get_serve_stats(
    player_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    set_number: SetFilter = None,
    phase: PhaseFilter = PointPhase.FULL,
    opponent_key: OpponentFilter = None,
    surface: SurfaceFilter = None,
) -> ServeStats:
    """The serve tab, both sides at once so toggling costs no second request."""
    owned_player(db, player_id, coach.id)
    return _serve_tab(
        db, player_id, _player_scope(db, player_id, opponent_key, set_number, phase, surface)
    )


@match_router.get("/serve", response_model=ServeStats)
def get_match_serve_stats(
    match_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    set_number: SetFilter = None,
    phase: PhaseFilter = PointPhase.FULL,
) -> ServeStats:
    """The serve tab for one match, in the shape the player-wide route answers in."""
    match = match_for_coach(db, match_id, coach.id)
    scope = PointScope(match_ids=[match.id], set_number=set_number, phase=phase)
    return _serve_tab(db, match.player_id, scope)


@dataclass
class _StyleTally:
    """One style's points, and the three breakdowns drawn underneath it."""

    count: int = 0
    wings: Counter[Wing] = field(default_factory=Counter)
    shots: Counter[ShotType] = field(default_factory=Counter)
    zones: Counter[str] = field(default_factory=Counter)
    reasons: Counter[UnusualReason] = field(default_factory=Counter)


def _zone_label(row: Row[Any]) -> str | None:
    """Where a point's final ball landed, or None where none was recorded.

    Read off the placement columns themselves rather than off ball_in, which the
    table pairs with neither of them.
    """
    if row.ball_half is not None:
        return f"{row.ball_half.value.capitalize()} {row.ball_depth.value}"
    if row.ball_out_mode is not None:
        return row.ball_out_mode.value.capitalize()
    return None


def _shot_type_rows(shots: Counter[ShotType]) -> list[BreakdownRow]:
    """Every shot type, or nothing at all while this style has recorded no shot."""
    if not shots:
        return []
    ceiling = max(shots.values())
    # "Dropshot", where _SHOT_LABEL above says "drop shot": the rally tab keys its
    # shot icons on these exact strings, and the two lists are read by different
    # components.
    return [
        BreakdownRow(label=shot.value.capitalize(), value=shots[shot], max=ceiling)
        for shot in ShotType
    ]


def _unusual_reason_rows(reasons: Counter[UnusualReason]) -> list[BreakdownRow]:
    """The unusual endings actually seen, most frequent first."""
    ceiling = max(reasons.values(), default=0)
    return [
        BreakdownRow(label=reason.value.replace("_", " ").capitalize(), value=count, max=ceiling)
        for reason, count in sorted(reasons.items(), key=lambda item: (-item[1], item[0].value))
    ]


def _point_ender_style(
    won: bool, kind: PointEnderKind, tallies: dict[tuple[bool, PointEnderKind], _StyleTally]
) -> PointEnderStyle:
    """One card, present at zero so the toggle always has its three to draw."""
    tally = tallies.get((won, kind), _StyleTally())
    unusual = kind is PointEnderKind.UNUSUAL
    wing = None
    if not unusual:
        # Zeroes rather than null on a style whose points recorded no shot: null is
        # how a card says it is the unusual one, which has no shot of its own.
        wing = WingSplit(forehand=tally.wings[Wing.FOREHAND], backhand=tally.wings[Wing.BACKHAND])
    return PointEnderStyle(
        kind=kind,
        label=_POINT_ENDER_LABEL[won, kind],
        count=tally.count,
        detail=PointEnderStyleDetail(
            wing=wing,
            shot_type=_shot_type_rows(tally.shots),
            court_zones=[CourtZoneCount(zone=zone, count=tally.zones[zone]) for zone in COURT_ZONES]
            if tally.zones
            else [],
            unusual_reasons=_unusual_reason_rows(tally.reasons) if unusual else None,
        ),
    )


def _point_ender_styles(db: Session, player_id: uuid.UUID, scope: PointScope) -> PointEnderStyles:
    """The three point-ender cards per side, each with its drill-down.

    One grouped query over every column a card draws from, folded in Python: the
    breakdowns count the same points under different keys, so a query apiece would
    read those points three times over.
    """
    statement = (
        select(
            Point.won,
            Point.end_reason,
            Point.wing,
            Point.shot_type,
            Point.ball_half,
            Point.ball_depth,
            Point.ball_out_mode,
            Point.unusual_reason,
            func.count().label("points"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(
            Match.player_id == player_id,
            Point.end_reason.in_(tuple(_POINT_ENDER_KIND)),
            *scope.conditions(),
        )
        .group_by(
            Point.won,
            Point.end_reason,
            Point.wing,
            Point.shot_type,
            Point.ball_half,
            Point.ball_depth,
            Point.ball_out_mode,
            Point.unusual_reason,
        )
    )

    tallies: dict[tuple[bool, PointEnderKind], _StyleTally] = {}
    for row in db.execute(statement):
        tally = tallies.setdefault((row.won, _POINT_ENDER_KIND[row.end_reason]), _StyleTally())
        tally.count += row.points
        if row.wing is not None:
            tally.wings[row.wing] += row.points
            tally.shots[row.shot_type] += row.points
        zone = _zone_label(row)
        if zone is not None:
            tally.zones[zone] += row.points
        if row.unusual_reason is not None:
            tally.reasons[row.unusual_reason] += row.points

    return PointEnderStyles(
        you=[_point_ender_style(True, kind, tallies) for kind in PointEnderKind],
        opponents=[_point_ender_style(False, kind, tallies) for kind in PointEnderKind],
    )


def _outcome_mix(counts: Row[Any]) -> list[OutcomeMixRow]:
    """Each side's own last actions, split between forcing shots and errors.

    A row groups the points that side decided, so the player's row is the hero
    ratio's two counts as percentages and the opponents' row is its mirror.
    """
    rows = []
    yours = counts.forced_won + counts.mistake_lost
    if yours:
        rows.append(
            OutcomeMixRow(
                label="You",
                forced=round(100 * counts.forced_won / yours),
                unforced=round(100 * counts.mistake_lost / yours),
            )
        )
    theirs = counts.forced_lost + counts.mistake_won
    if theirs:
        rows.append(
            OutcomeMixRow(
                label="Opponents",
                forced=round(100 * counts.forced_lost / theirs),
                unforced=round(100 * counts.mistake_won / theirs),
            )
        )
    return rows


def _rally_length(counts: Row[Any]) -> list[RallyLengthBucket]:
    """The four buckets whole, or nothing while no point carries one.

    Whole so the histogram shows the shape of the distribution, gaps included; points
    that recorded no bucket are simply absent.
    """
    counted = [
        (_RALLY_LENGTH_LABEL[bucket], getattr(counts, f"rally_{bucket.value}"))
        for bucket in RallyBucket
    ]
    if not sum(count for _, count in counted):
        return []
    return [RallyLengthBucket(label=label, count=count) for label, count in counted]


def _rally_tab(db: Session, player_id: uuid.UUID, scope: PointScope) -> RallyStats:
    """The rally tab over whichever of the player's matches the caller scoped to."""
    counts = _point_counts(db, player_id, scope)
    won_by_shot, lost_by_shot, shot_frequency = _shot_breakdowns(db, player_id, scope)
    return RallyStats(
        hero=_forced_unforced(counts.forced_won, counts.mistake_lost),
        won=counts.won,
        lost=counts.total - counts.won,
        won_by_shot=won_by_shot,
        lost_by_shot=lost_by_shot,
        outcome_mix=_outcome_mix(counts),
        styles=_point_ender_styles(db, player_id, scope),
        errors_under_pressure=_percent(
            "Errors under pressure (BP)",
            counts.bp_mistakes,
            counts.bp_points,
            higher_is_better=False,
        ),
        errors_overall=_percent(
            "Errors overall", counts.mistake_lost, counts.total, higher_is_better=False
        ),
        shot_frequency=shot_frequency,
        rally_length=_rally_length(counts),
    )


@router.get("/rally", response_model=RallyStats, responses=OPPONENT_NOT_FOUND)
def get_rally_stats(
    player_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    set_number: SetFilter = None,
    phase: PhaseFilter = PointPhase.FULL,
    opponent_key: OpponentFilter = None,
    surface: SurfaceFilter = None,
) -> RallyStats:
    """The rally tab: how points end once the ball is in play."""
    owned_player(db, player_id, coach.id)
    return _rally_tab(
        db, player_id, _player_scope(db, player_id, opponent_key, set_number, phase, surface)
    )


@match_router.get("/rally", response_model=RallyStats)
def get_match_rally_stats(
    match_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    set_number: SetFilter = None,
    phase: PhaseFilter = PointPhase.FULL,
) -> RallyStats:
    """The rally tab for one match, in the shape the player-wide route answers in."""
    match = match_for_coach(db, match_id, coach.id)
    scope = PointScope(match_ids=[match.id], set_number=set_number, phase=phase)
    return _rally_tab(db, match.player_id, scope)


def _percent_value(part: int, whole: int) -> float:
    """A whole-number percentage, over a denominator the caller has already floored."""
    return round(100 * part / whole)


def _percent_value_or_none(part: int, whole: int) -> float | None:
    """`_percent_value`, for a denominator that can genuinely be zero."""
    if whole == 0:
        return None
    return _percent_value(part, whole)


def _series_ratio(forced: int, unforced: int) -> float | None:
    """The forced : unforced ratio only where the denominator is real.

    Not `_ratio_value`: the forced count it stands in with is a display convention
    ("4:0"), and as a series member it would set the spread for the whole baseline
    off one clean match, which is a z-score the client cannot read.
    """
    if unforced == 0:
        return None
    return round(forced / unforced, 2)


@dataclass(frozen=True)
class _TrackedStatSpec:
    """One tracked stat: its label, its value over one match, and that value's sample.

    No two stats count the same points, so each brings its own sample: the ratio's are
    the rally endings that decided a point, the serve percentage's the points this
    player served. A percentage samples the denominator it divides by, which is what
    lets `_percent_value` divide without a zero check.
    """

    key: TrackedStatKey
    label: str
    unit: MetricUnit
    value: Callable[[Row[Any]], float | None]
    sample: Callable[[Row[Any]], int]


# Two stats, both oriented so higher is better, which is what `TrackedStat` promises
# the client. A third would need that orientation before it could join them.
_TRACKED_STATS = (
    _TrackedStatSpec(
        TrackedStatKey.FORCED_TO_UNFORCED,
        FORCED_UNFORCED_LABEL,
        MetricUnit.RATIO,
        lambda counts: _series_ratio(counts.forced_won, counts.mistake_lost),
        lambda counts: counts.forced_won + counts.mistake_lost,
    ),
    _TrackedStatSpec(
        TrackedStatKey.FIRST_SERVE_IN,
        FIRST_SERVE_IN_LABEL,
        MetricUnit.PERCENT,
        lambda counts: _percent_value(counts.first_in, counts.serve_points),
        lambda counts: counts.serve_points,
    ),
)


# A range of match dates, both ends counted.
_DateWindow = tuple[date, date]


def _within(window: _DateWindow | None) -> list[Any]:
    """The window as conditions, or nothing at all where a caller wants the lot.

    Bounded at both ends, so a read that draws a fixed number of buckets gets rows
    it has a bucket for, whatever date a row happens to carry.
    """
    if window is None:
        return []
    first, last = window
    return [Match.played_on >= first, Match.played_on <= last]


def _on_surface(surface: Surface | None) -> list[Any]:
    """The surface term, or nothing at all where a caller wants every surface (#225).

    Same shape as `_within` above, and spliced in beside it: both are conditions
    against the same `Match` join, so narrowing by date and by surface at once is
    just both lists concatenated.
    """
    return [] if surface is None else [Match.surface == surface]


def _roster_matches(
    db: Session,
    player_ids: Sequence[uuid.UUID],
    window: _DateWindow | None = None,
    surface: Surface | None = None,
) -> dict[uuid.UUID, list[Row[Any]]]:
    """Every match on the roster, newest first, grouped by player.

    One query for the whole roster rather than one per player, and every player gets
    an entry so a roster row is never dropped for having no matches — including one
    with no matches on a filtered `surface`, which must still return zeroed rather
    than disappear from the roster. `window` bounds the read to a caller that draws
    one span rather than a whole career.
    """
    grouped: dict[uuid.UUID, list[Row[Any]]] = {player_id: [] for player_id in player_ids}
    for row in db.execute(
        select(Match.player_id, Match.id, Match.played_on, Match.result)
        .where(Match.player_id.in_(player_ids), *_within(window), *_on_surface(surface))
        .order_by(Match.played_on.desc(), Match.created_at.desc())
    ):
        grouped[row.player_id].append(row)
    return grouped


def _tracked_counts_by_match(
    db: Session,
    player_ids: Sequence[uuid.UUID],
    window: _DateWindow | None = None,
    surface: Surface | None = None,
) -> dict[uuid.UUID, Row[Any]]:
    """The tracked stats' tallies for every match on the roster, one row per match.

    Grouped by match and not by player because each stat's baseline is a series of
    per-match values; the period's own ratio is summed back off these rows.
    """
    tracked = Point.server == MatchSide.TRACKED
    rows = db.execute(
        select(
            Point.match_id,
            func.count()
            .filter(and_(Point.won, Point.end_reason == EndReason.FORCED))
            .label("forced_won"),
            func.count()
            .filter(and_(~Point.won, Point.end_reason == EndReason.MISTAKE))
            .label("mistake_lost"),
            func.count().filter(tracked).label("serve_points"),
            func.count()
            .filter(and_(tracked, Point.serve1_outcome != ServeOutcome.FAULT))
            .label("first_in"),
        )
        .select_from(Point)
        .join(Match, Point.match_id == Match.id)
        .where(Match.player_id.in_(player_ids), *_within(window), *_on_surface(surface))
        .group_by(Point.match_id)
    ).all()
    return {row.match_id: row for row in rows}


def _current_streak(resulted_newest_first: Sequence[Row[Any]]) -> CurrentStreak | None:
    """The latest result and its run, or None until one match carries a result."""
    if not resulted_newest_first:
        return None
    outcome = resulted_newest_first[0].result
    run = takewhile(lambda row: row.result == outcome, resulted_newest_first)
    return CurrentStreak(outcome=outcome, length=sum(1 for _ in run))


def _tracked_stat(
    spec: _TrackedStatSpec,
    matches_newest_first: Sequence[Row[Any]],
    counts_by_match: dict[uuid.UUID, Row[Any]],
) -> TrackedStat | None:
    """The stat's latest value against the baseline before it, or None without both.

    A match the stat cannot be computed over, or that would take it from fewer than
    `MIN_POINTS_FOR_TRACKED_STAT` points, is skipped rather than counted as zero, the
    newest on the same terms as the rest: too few points can neither widen the
    deviation nor become the value divided by it. Two values are the least a mean and
    a deviation can be taken from.
    """
    values: list[float] = []
    for row in matches_newest_first:
        counts = counts_by_match.get(row.id)
        if counts is None or spec.sample(counts) < MIN_POINTS_FOR_TRACKED_STAT:
            continue
        value = spec.value(counts)
        if value is not None:
            values.append(value)
    if len(values) < 2:
        return None
    # The latest value is left out of its own baseline: counted in, a single match
    # pulls the mean toward itself and caps how far from it the value can ever sit.
    baseline = values[1 : 1 + BASELINE_MATCHES]
    return TrackedStat(
        key=spec.key,
        label=spec.label,
        unit=spec.unit,
        current=values[0],
        rolling_mean=round(fmean(baseline), 2),
        # Population and not sample deviation: a baseline of one match has no sample
        # deviation at all, where the population figure is zero and the client's own
        # rule already skips a stat that never moved. Rounding a divisor is also the
        # epsilon on that rule, a spread this small being noise to divide by.
        rolling_std_dev=round(pstdev(baseline), 2),
    )


def _squad_member(
    player_id: uuid.UUID,
    matches_newest_first: Sequence[Row[Any]],
    counts_by_match: dict[uuid.UUID, Row[Any]],
) -> SquadMemberStats:
    today = date.today()
    period = [row for row in matches_newest_first if row.played_on.year == today.year]
    resulted = [row for row in matches_newest_first if row.result is not None]
    period_resulted = [row for row in period if row.result is not None]
    period_counts = [counts_by_match[row.id] for row in period if row.id in counts_by_match]
    return SquadMemberStats(
        player_id=player_id,
        matches_logged_this_period=len(period),
        period_record=WinLossRecord(
            wins=_wins(period_resulted), losses=len(period_resulted) - _wins(period_resulted)
        ),
        last5=[row.result for row in reversed(resulted[:5])],
        # Summed over the period's matches rather than averaged over their ratios, so
        # a match of four points weighs what four points are worth.
        forced_to_unforced_ratio=_ratio_value(
            sum(counts.forced_won for counts in period_counts),
            sum(counts.mistake_lost for counts in period_counts),
        ),
        first_serve_in_percent=_percent_value_or_none(
            sum(counts.first_in for counts in period_counts),
            sum(counts.serve_points for counts in period_counts),
        ),
        current_streak=_current_streak(resulted),
        days_since_last_match=(
            (today - matches_newest_first[0].played_on).days if matches_newest_first else None
        ),
        tracked_stats=[
            stat
            for stat in (
                _tracked_stat(spec, matches_newest_first, counts_by_match)
                for spec in _TRACKED_STATS
            )
            if stat is not None
        ],
    )


@squad_router.get("/members", response_model=list[SquadMemberStats])
def list_squad_member_stats(
    db: DbSession, coach: CurrentCoach, surface: SurfaceFilter = None
) -> list[SquadMemberStats]:
    """Per-player squad figures, one row per roster player.

    Serves both screens that rank a squad: the home screen's snapshot (#204) and the
    Squad stats leaderboard and headline (#237). The thresholds that turn these
    numbers into a flag or a rank are the web app's (`lib/analytics/attention.ts`,
    `lib/analytics/squad-stats.ts`); what this endpoint owns is the windows they are
    measured over. The period is the calendar year, as the overview tab's season
    record is, and scopes `matches_logged_this_period`, `period_record`, the
    forced : unforced ratio and the first-serve percentage; the streak, the last five
    results and the days since the last match are counted over every match, so a run
    that started in December is still a run in January. A tracked stat's `current` is
    its value over the latest match that can answer it, against a baseline of the ten
    matches before that one.

    Both period rates pool the period's points rather than averaging its matches, so
    a four-point match weighs what four points are worth.

    `surface`, if given, narrows every count above to matches on that surface (#225).
    A player with none on the requested surface still returns a zeroed row rather
    than dropping off the roster — the same rule the empty-roster row above follows.
    """
    roster = list(
        db.scalars(
            select(Player.id)
            .where(Player.coach_id == coach.id)
            .order_by(Player.last_name, Player.first_name)
        )
    )
    if not roster:
        return []
    matches = _roster_matches(db, roster, surface=surface)
    counts_by_match = _tracked_counts_by_match(db, roster, surface=surface)
    return [_squad_member(player_id, matches[player_id], counts_by_match) for player_id in roster]


# Six weeks because the trend card is captioned with that window, and because a
# roster playing weekly fixtures fills six buckets where a longer window would
# mostly draw the gaps between terms.
SQUAD_TREND_WEEKS = 6


@dataclass
class _WeekTally:
    """One week's counts, pooled across every match the roster played in it."""

    wins: int = 0
    losses: int = 0
    forced: int = 0
    unforced: int = 0
    first_in: int = 0
    serve_points: int = 0


# Each metric off one week's pooled counts. `_series_ratio` rather than
# `_ratio_value` for the reason a tracked stat's series uses it: the forced count
# standing in for a missing denominator is a display convention, and as a point on a
# line it would read as a real value.
_SQUAD_METRIC_VALUE: dict[SquadMetric, Callable[[_WeekTally], float | None]] = {
    SquadMetric.RECORD: lambda week: _percent_value_or_none(week.wins, week.wins + week.losses),
    SquadMetric.FORCED_TO_UNFORCED: lambda week: _series_ratio(week.forced, week.unforced),
    SquadMetric.FIRST_SERVE_IN: lambda week: _percent_value_or_none(
        week.first_in, week.serve_points
    ),
}

SquadMetricFilter = Annotated[
    SquadMetric, Query(description="Which roster-wide figure the series carries.")
]


def _week_tallies(
    db: Session,
    roster: Sequence[uuid.UUID],
    first_monday: date,
    surface: Surface | None = None,
) -> list[_WeekTally]:
    """The window's weeks, oldest first, each holding its own matches' counts.

    Always the full six, so an empty roster and a week nobody played in answer the
    same way: a week with nothing counted in it. `surface`, if given, narrows every
    week's pooled matches to that surface (#225).
    """
    weeks = [_WeekTally() for _ in range(SQUAD_TREND_WEEKS)]
    if not roster:
        return weeks
    window = (first_monday, first_monday + timedelta(weeks=SQUAD_TREND_WEEKS, days=-1))
    counts_by_match = _tracked_counts_by_match(db, roster, window, surface)
    for row in chain.from_iterable(_roster_matches(db, roster, window, surface).values()):
        week = weeks[(row.played_on - first_monday).days // 7]
        if row.result is not None:
            if row.result == MatchResult.WIN:
                week.wins += 1
            else:
                week.losses += 1
        counts = counts_by_match.get(row.id)
        if counts is None:
            continue
        week.forced += counts.forced_won
        week.unforced += counts.mistake_lost
        week.first_in += counts.first_in
        week.serve_points += counts.serve_points
    return weeks


@squad_router.get("/trend", response_model=list[SquadTrendPoint])
def get_squad_trend(
    metric: SquadMetricFilter,
    db: DbSession,
    coach: CurrentCoach,
    surface: SurfaceFilter = None,
) -> list[SquadTrendPoint]:
    """One roster-wide figure a week, over the six weeks ending with this one.

    Weeks run Monday to Sunday, so a weekend's fixtures land in one bucket rather
    than split across two, and the sixth is the current week however few of its days
    have passed: a card about how the squad is trending now would be up to a week
    stale if it stopped last Sunday. All six come back in order, so a quiet fortnight
    draws a gap in the line rather than a shorter line.

    A week's figure pools every match the roster played in it rather than averaging
    the roster's players, for the reason the period's own rates are pooled: one match
    is one match's worth of evidence whoever played it, where a per-player mean would
    weigh a player's single match against another's four. A week whose matches cannot
    answer the metric, one with no recorded result, no unforced error or no serve
    among them, carries a null rather than a zero.

    `surface`, if given, narrows every week's pooled matches to that surface (#225).
    """
    roster = list(db.scalars(select(Player.id).where(Player.coach_id == coach.id)))
    today = date.today()
    first_monday = today - timedelta(days=today.weekday(), weeks=SQUAD_TREND_WEEKS - 1)
    value = _SQUAD_METRIC_VALUE[metric]
    return [
        SquadTrendPoint(week=f"Wk {position}", value=value(week))
        for position, week in enumerate(_week_tallies(db, roster, first_monday, surface), start=1)
    ]
