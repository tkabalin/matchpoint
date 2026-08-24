import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
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
    MatchSet,
    MatchSide,
    Point,
    ServeOutcome,
    ShotType,
    UnusualReason,
    Wing,
)
from matchpoint_api.routers.matches import match_for_coach
from matchpoint_api.routers.players import owned_player
from matchpoint_api.schemas.analytics import (
    BreakdownRow,
    CorrelationPoint,
    CourtZoneCount,
    DistributionBucket,
    FaultModeShares,
    FaultModeSplit,
    HeadToHeadDetail,
    HeadToHeadSummary,
    Metric,
    MetricUnit,
    OutcomeMixRow,
    PlayerOverview,
    PointEnderKind,
    PointEnderStyle,
    PointEnderStyleDetail,
    PointEnderStyles,
    PointPhase,
    RallyStats,
    ServeSideStats,
    ServeStats,
    ServeTrendPoint,
    ShotShare,
    SlopeLine,
    TrendStats,
    TrendWindow,
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

# Mirrored by the head-to-head tab's caption: below this many meetings the list shows
# the raw record and no rate, a percentage of two matches being noise wearing a unit.
MIN_MEETINGS_FOR_RATE = 3

# Bars need a ceiling even where a rate has no natural one; these match the scale the
# dashboard was designed against, and a value past one simply becomes its own ceiling.
DOUBLE_FAULT_CAP = 5.0
ACES_CAP = 6.0
RATIO_CAP = 3.0

FORCED_UNFORCED_LABEL = "Forced : Unforced ratio"

# How many matches the serve trend line carries. Six because the chart draws its
# match labels at 9px on a phone, and a longer season would crowd them into each
# other rather than say anything more about recent form.
SERVE_TREND_MATCHES = 6

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

# The nine zones a final ball can land in, in the order the court diagram reads
# them: each half from the net outward, then the three ways a ball goes out.
COURT_ZONES = (
    "Deuce short",
    "Deuce mid",
    "Deuce deep",
    "Ad short",
    "Ad mid",
    "Ad deep",
    "Net",
    "Long",
    "Wide",
)


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


def _forced_unforced(
    forced: int, unforced: int, *, baseline: float | None = None, delta: float | None = None
) -> Metric | None:
    """The forced : unforced ratio, or None while no rally has ended either way.

    With no unforced errors at all the true ratio has no value, so the count itself
    is shown ("4:0") while the bar fills to its ceiling.
    """
    if forced + unforced == 0:
        return None
    if unforced == 0:
        value = float(forced)
        display = f"{forced}:0"
        ceiling = value
    else:
        value = round(forced / unforced, 2)
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
) -> tuple[list[BreakdownRow], list[BreakdownRow], list[ShotShare]]:
    """The by-final-shot bars for wins and losses, plus the radar's shares.

    The stored shot is the last successful one (#175): on a win it is the player's
    own, so the win rows and the radar describe the player; on a loss it is the
    opponent's, so the loss rows describe the shots points were lost to, split into
    the player's unforced errors after them (value) and being beaten outright
    (secondary_value).
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

    won_total = sum(row.mistakes + row.forced for row in won_rows)
    shot_frequency = []
    if won_total:
        by_type = {shot: 0 for shot in ShotType}
        for row in won_rows:
            by_type[row.shot_type] += row.mistakes + row.forced
        shot_frequency = [
            ShotShare(shot=_SHOT_LABEL[shot].capitalize(), share=round(count / won_total, 2))
            for shot, count in by_type.items()
        ]
    return won_by_shot, lost_by_shot, shot_frequency


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


@router.get("/overview", response_model=PlayerOverview)
def get_player_overview(player_id: uuid.UUID, db: DbSession, coach: CurrentCoach) -> PlayerOverview:
    """The overview tab: form, the headline rates, and the win/loss record.

    Whole-career only, and takes no set or phase filter (#227): four of its seven
    fields are counted over matches rather than points, so a scoped request would
    answer with three narrowed numbers beside four that quietly ignored the scope.
    """
    owned_player(db, player_id, coach.id)
    results = _results_newest_first(db, player_id)
    counts = _point_counts(db, player_id, PointScope())

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
    counts: Row[Any], fault_mode: FaultModeSplit, trend: list[ServeTrendPoint]
) -> ServeSideStats:
    sets_sample = f"n={counts.sets_played} sets"
    matches_sample = f"n={counts.matches_with_points}"
    metrics = [
        _percent("Break points saved", counts.bp_saved, counts.bp_faced),
        _percent("1st serve in %", counts.first_in, counts.serve_points),
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
        fault_mode=fault_mode,
        trend=trend,
    )


def _returning_stats(
    db: Session,
    player_id: uuid.UUID,
    counts: Row[Any],
    trend: list[ServeTrendPoint],
    scope: PointScope,
) -> ServeSideStats:
    metrics = [
        _percent("Break points converted", counts.bp_converted, counts.bp_chances),
        _percent("1st serve return points won", counts.their_first_in_won, counts.their_first_in),
        _percent("2nd serve return points won", counts.their_second_won, counts.their_second),
    ]
    breakdown = []
    if counts.return_points:
        # Labelled "returned" and not "count": Row attribute access would find the
        # tuple method count() first and hand back a callable instead of the tally.
        statement = (
            select(Point.return_outcome, func.count().label("returned"))
            .select_from(Point)
            .join(Match, Point.match_id == Match.id)
            .where(
                Match.player_id == player_id,
                Point.server == MatchSide.OPPONENT,
                Point.return_outcome.is_not(None),
                *scope.conditions(),
            )
            .group_by(Point.return_outcome)
        )
        by_outcome = {row.return_outcome.value: row.returned for row in db.execute(statement)}
        values = {
            "Returned in": by_outcome.get("in", 0),
            "Return error (net)": by_outcome.get("net", 0),
            "Return error (long)": by_outcome.get("long", 0),
            "Return error (wide)": by_outcome.get("wide", 0),
        }
        ceiling = max(values.values())
        breakdown = [
            BreakdownRow(label=label, value=value, max=ceiling) for label, value in values.items()
        ]
    return ServeSideStats(
        hero=_percent("Return games won %", counts.return_won, counts.return_games),
        metrics=[metric for metric in metrics if metric is not None],
        breakdown=breakdown,
        # Empty rather than zeroed: the opponent's serve is captured as in or
        # faulted and never placed, so there is no direction here to be wrong about.
        fault_mode=FaultModeSplit(first_serve=None, second_serve=None),
        trend=trend,
    )


def _serve_tab(db: Session, player_id: uuid.UUID, scope: PointScope) -> ServeStats:
    """The serve tab over whichever of the player's matches the caller scoped to."""
    counts = _point_counts(db, player_id, scope)
    trends = _serve_trends(db, player_id, scope)
    return ServeStats(
        serving=_serving_stats(
            counts, _fault_modes(db, player_id, scope), trends[MatchSide.TRACKED]
        ),
        returning=_returning_stats(db, player_id, counts, trends[MatchSide.OPPONENT], scope),
    )


@router.get("/serve", response_model=ServeStats)
def get_serve_stats(
    player_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    set_number: SetFilter = None,
    phase: PhaseFilter = PointPhase.FULL,
) -> ServeStats:
    """The serve tab, both sides at once so toggling costs no second request."""
    owned_player(db, player_id, coach.id)
    return _serve_tab(db, player_id, PointScope(set_number=set_number, phase=phase))


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


def _rally_tab(db: Session, player_id: uuid.UUID, scope: PointScope) -> RallyStats:
    """The rally tab over whichever of the player's matches the caller scoped to."""
    counts = _point_counts(db, player_id, scope)
    won_by_shot, lost_by_shot, shot_frequency = _shot_breakdowns(db, player_id, scope)
    return RallyStats(
        hero=_forced_unforced(counts.forced_won, counts.mistake_lost),
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
    )


@router.get("/rally", response_model=RallyStats)
def get_rally_stats(
    player_id: uuid.UUID,
    db: DbSession,
    coach: CurrentCoach,
    set_number: SetFilter = None,
    phase: PhaseFilter = PointPhase.FULL,
) -> RallyStats:
    """The rally tab: how points end once the ball is in play."""
    owned_player(db, player_id, coach.id)
    return _rally_tab(db, player_id, PointScope(set_number=set_number, phase=phase))


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


def _window_values(
    counts: Row[Any], results: Sequence[Row[Any]]
) -> dict[str, tuple[float, str] | None]:
    """Each trend metric's value and sample over one window, or None where empty.

    One shape for the current window, the previous one and all time, so baseline and
    delta are the same arithmetic whatever the metric.
    """

    def pct(part: int, whole: int, sample: str | None = None) -> tuple[float, str] | None:
        if whole == 0:
            return None
        return round(100 * part / whole), sample if sample is not None else f"n={whole}"

    ratio = None
    if counts.mistake_lost:
        ratio = (
            round(counts.forced_won / counts.mistake_lost, 2),
            f"n={counts.forced_won + counts.mistake_lost}",
        )
    double_faults = None
    if counts.sets_played:
        double_faults = (
            round(counts.double_faults / counts.sets_played, 1),
            f"n={counts.sets_played} sets",
        )
    return {
        "form": pct(_wins(results), len(results)),
        "hold": pct(counts.hold_won, counts.hold_games),
        "return_games": pct(counts.return_won, counts.return_games),
        "ratio": ratio,
        "bp_converted": pct(counts.bp_converted, counts.bp_chances),
        "second_won": pct(counts.second_won, counts.second_points),
        "double_faults": double_faults,
    }


# What each trend key renders as: label, unit, ceiling, and which direction is good.
_TREND_SHAPE: dict[str, tuple[str, MetricUnit, float, bool]] = {
    "form": ("Form (win %)", MetricUnit.PERCENT, 100, True),
    "hold": ("Hold %", MetricUnit.PERCENT, 100, True),
    "return_games": ("Return games won %", MetricUnit.PERCENT, 100, True),
    "ratio": (FORCED_UNFORCED_LABEL, MetricUnit.RATIO, RATIO_CAP, True),
    "bp_converted": ("Break points converted", MetricUnit.PERCENT, 100, True),
    "second_won": ("2nd serve points won", MetricUnit.PERCENT, 100, True),
    "double_faults": ("Double faults / set", MetricUnit.PER_SET, DOUBLE_FAULT_CAP, False),
}


@router.get("/trends", response_model=TrendStats)
def get_trend_stats(
    player_id: uuid.UUID, window: TrendWindow, db: DbSession, coach: CurrentCoach
) -> TrendStats:
    """The trends tab: the window's metrics against all time, plus the two charts.

    Baselines are the same metric over every match; deltas compare the window before
    this one, so they exist only for the counted windows, never for the season.
    """
    owned_player(db, player_id, coach.id)
    matches = list(
        db.execute(
            select(Match.id, Match.result, Match.played_on)
            .where(Match.player_id == player_id)
            .order_by(Match.played_on.desc(), Match.created_at.desc())
        )
    )
    if window == TrendWindow.SEASON:
        current = [row for row in matches if row.played_on.year == date.today().year]
        previous: list[Row[Any]] = []
    else:
        size = 5 if window == TrendWindow.LAST5 else 10
        current = matches[:size]
        # Deltas compare a whole previous window or none, as the overview's form
        # metric does: against a partial one, early swings would read as trends.
        previous = matches[size : 2 * size]
        if len(previous) < size:
            previous = []

    def values_over(rows: Sequence[Row[Any]]) -> dict[str, tuple[float, str] | None]:
        ids = [row.id for row in rows]
        with_result = [row for row in rows if row.result is not None]
        return _window_values(_point_counts(db, player_id, PointScope(match_ids=ids)), with_result)

    current_values = values_over(current)
    previous_values = values_over(previous) if previous else dict.fromkeys(current_values)
    all_time = _window_values(
        _point_counts(db, player_id, PointScope()),
        [row for row in matches if row.result is not None],
    )

    metrics = []
    for key, (label, unit, cap, higher_is_better) in _TREND_SHAPE.items():
        entry = current_values[key]
        if entry is None:
            continue
        value, sample = entry
        baseline_entry = all_time[key]
        previous_entry = previous_values[key]
        metrics.append(
            Metric(
                label=label,
                value=value,
                unit=unit,
                sample_size=sample,
                baseline=baseline_entry[0] if baseline_entry else None,
                delta=round(value - previous_entry[0], 2) if previous_entry else None,
                max=max(cap, value),
                higher_is_better=higher_is_better,
            )
        )

    current_ids = [row.id for row in current]
    return TrendStats(
        metrics=metrics,
        distribution_label="1st serve in %",
        distribution=_serve_in_distribution(db, current_ids),
        correlation=_error_correlation(db, current_ids),
    )


def _serve_in_distribution(db: Session, match_ids: Sequence[uuid.UUID]) -> list[DistributionBucket]:
    """Per-match first-serve-in percentages, gathered into five-point buckets.

    Contiguous from the lowest occupied bucket to the highest, zeros included, so the
    histogram shows the spread rather than deleting the gaps that are the point.
    """
    rows = db.execute(
        select(
            func.count().filter(Point.serve1_outcome != ServeOutcome.FAULT).label("landed"),
            func.count().label("serves"),
        )
        .select_from(Point)
        .where(
            Point.match_id.in_(match_ids),
            Point.server == MatchSide.TRACKED,
        )
        .group_by(Point.match_id)
    ).all()
    if not rows:
        return []
    # 100% would otherwise mint a bucket of its own above the scale, so it joins the top.
    buckets = [min(round(100 * row.landed / row.serves) // 5, 19) for row in rows]
    return [
        DistributionBucket(
            bucket=f"{5 * index}–{5 * index + 5}%",
            matches=sum(bucket == index for bucket in buckets),
        )
        for index in range(min(buckets), max(buckets) + 1)
    ]


def _error_correlation(db: Session, match_ids: Sequence[uuid.UUID]) -> list[CorrelationPoint]:
    """Per match: the player's unforced errors against the games they lost.

    Games lost come off the derived set rows, which ingest recomputes with every
    flush, so a match appears once it has both points and a set tally.
    """
    errors = db.execute(
        select(
            Point.match_id,
            func.count()
            .filter(and_(~Point.won, Point.end_reason == EndReason.MISTAKE))
            .label("errors"),
        )
        .where(Point.match_id.in_(match_ids))
        .group_by(Point.match_id)
    ).all()
    games_lost: dict[uuid.UUID, int] = {
        row.match_id: int(row.games)
        for row in db.execute(
            select(MatchSet.match_id, func.sum(MatchSet.games_won_opponent).label("games"))
            .where(MatchSet.match_id.in_(match_ids))
            .group_by(MatchSet.match_id)
        )
    }
    return [
        CorrelationPoint(unforced_errors=row.errors, games_lost=games_lost[row.match_id])
        for row in sorted(errors, key=lambda row: row.errors)
        if row.match_id in games_lost
    ]


def _normalised(opponent_name: str) -> str:
    return opponent_name.strip().lower()


def _summarise(key: str, meetings: list[Row[Any]]) -> HeadToHeadSummary:
    wins = _wins(meetings)
    return HeadToHeadSummary(
        opponent_key=key,
        # The list is newest first, so the first row carries the latest spelling.
        opponent_name=meetings[0].opponent_name,
        meetings=len(meetings),
        record=WinLossRecord(wins=wins, losses=len(meetings) - wins),
        win_rate=(
            round(100 * wins / len(meetings)) if len(meetings) >= MIN_MEETINGS_FOR_RATE else None
        ),
    )


def _meetings_by_opponent(db: Session, player_id: uuid.UUID) -> dict[str, list[Row[Any]]]:
    """The player's resulted matches grouped by normalised opponent name.

    Free text is the whole identity (#172): opponents are rarely in the coach's
    roster, so the trimmed lowercase name is the matchup key, and a typo splitting
    one opponent in two is the accepted cost.
    """
    groups: dict[str, list[Row[Any]]] = {}
    for row in _results_newest_first(db, player_id):
        if row.opponent_name is None:
            continue
        groups.setdefault(_normalised(row.opponent_name), []).append(row)
    return groups


@router.get("/head-to-head", response_model=list[HeadToHeadSummary])
def list_head_to_head(
    player_id: uuid.UUID, db: DbSession, coach: CurrentCoach
) -> list[HeadToHeadSummary]:
    """Every opponent this player has a resulted match against, most-met first."""
    owned_player(db, player_id, coach.id)
    summaries = [
        _summarise(key, meetings) for key, meetings in _meetings_by_opponent(db, player_id).items()
    ]
    return sorted(summaries, key=lambda summary: (-summary.meetings, summary.opponent_name))


def _half_slope_values(counts: Row[Any]) -> dict[str, float] | None:
    """One half's three slope values on a shared 0-100 scale, or None if any is empty."""
    if not counts.hold_games or not counts.bp_chances or not counts.mistake_lost:
        return None
    ratio = counts.forced_won / counts.mistake_lost
    return {
        "Hold %": round(100 * counts.hold_won / counts.hold_games),
        "BP conv": round(100 * counts.bp_converted / counts.bp_chances),
        # The ratio runs 0-3 where the other two run 0-100, so it is scaled onto
        # their axis to share the chart, and clamped where it runs past its cap.
        "F:UE": round(min(ratio, RATIO_CAP) / RATIO_CAP * 100),
    }


def _slope(
    db: Session, player_id: uuid.UUID, meetings_oldest_first: list[Row[Any]]
) -> list[SlopeLine] | None:
    if len(meetings_oldest_first) < 4:
        return None
    first = _half_slope_values(
        _point_counts(
            db, player_id, PointScope(match_ids=[row.id for row in meetings_oldest_first[:2]])
        )
    )
    last = _half_slope_values(
        _point_counts(
            db, player_id, PointScope(match_ids=[row.id for row in meetings_oldest_first[-2:]])
        )
    )
    if first is None or last is None:
        return None
    return [SlopeLine(label=label, first=first[label], last=last[label]) for label in first]


def _loss_patterns(db: Session, loss_ids: list[uuid.UUID], losses: int) -> list[BreakdownRow]:
    """How the losses arrived, each classified once, in priority order.

    Tiebreak means the deciding set held one; late-set fade is a deciding set lost
    from four games or more, tight until the end; broken early is a first-set break
    inside the first four games. A loss without point data stays unclassified.
    """
    sets_by_match: dict[uuid.UUID, list[Row[Any]]] = {}
    for row in db.execute(
        select(MatchSet.match_id, MatchSet.set_number, MatchSet.games_won_tracked).where(
            MatchSet.match_id.in_(loss_ids)
        )
    ):
        sets_by_match.setdefault(row.match_id, []).append(row)
    tiebreak_sets = {
        (row.match_id, row.set_number)
        for row in db.execute(
            select(Point.match_id, Point.set_number)
            .where(Point.match_id.in_(loss_ids), Point.in_tiebreak)
            .distinct()
        )
    }
    broken_early = set(
        db.scalars(
            select(Point.match_id)
            .where(
                Point.match_id.in_(loss_ids),
                Point.is_game_end,
                ~Point.in_tiebreak,
                Point.set_number == 1,
                Point.game_number <= 4,
                Point.server == MatchSide.TRACKED,
                ~Point.won,
            )
            .distinct()
        )
    )

    tallies = {"Late-set fade": 0, "Broken early": 0, "Tiebreak": 0}
    for match_id, sets in sets_by_match.items():
        deciding = max(sets, key=lambda row: row.set_number)
        if (match_id, deciding.set_number) in tiebreak_sets:
            tallies["Tiebreak"] += 1
        elif deciding.games_won_tracked >= 4:
            tallies["Late-set fade"] += 1
        elif match_id in broken_early:
            tallies["Broken early"] += 1
    return [
        BreakdownRow(label=label, value=value, max=max(losses, 1))
        for label, value in tallies.items()
    ]


# The opponent is a query parameter and not a path segment: the key is free text, and
# a name holding a slash or trimming down to "." cannot survive one.
@router.get("/head-to-head/detail", response_model=HeadToHeadDetail)
def get_head_to_head(
    player_id: uuid.UUID, opponent: str, db: DbSession, coach: CurrentCoach
) -> HeadToHeadDetail:
    """The full matchup view against one opponent, named by the list's key."""
    owned_player(db, player_id, coach.id)
    meetings = _meetings_by_opponent(db, player_id).get(_normalised(opponent))
    if meetings is None:
        raise HTTPException(status_code=404, detail="No matches against this opponent")
    summary = _summarise(_normalised(opponent), meetings)

    oldest_first = list(reversed(meetings))
    meeting_ids = [row.id for row in oldest_first]
    meeting_scope = PointScope(match_ids=meeting_ids)
    counts = _point_counts(db, player_id, meeting_scope)
    won_by_shot, _, shot_frequency = _shot_breakdowns(db, player_id, meeting_scope)
    loss_ids = [row.id for row in meetings if row.result == MatchResult.LOSS]

    your_serve = [
        _percent("1st serve points won", counts.first_in_won, counts.first_in),
        _percent("2nd serve points won", counts.second_won, counts.second_points),
        _per(
            "Double faults / set",
            counts.double_faults,
            counts.sets_played,
            unit=MetricUnit.PER_SET,
            cap=DOUBLE_FAULT_CAP,
            sample=f"n={counts.sets_played} sets",
        ),
    ]
    their_serve = [
        _percent(
            "Their 1st serve points won",
            counts.their_first_in - counts.their_first_in_won,
            counts.their_first_in,
            higher_is_better=False,
        ),
        _per(
            "Their aces / match",
            counts.their_aces,
            counts.matches_with_points,
            unit=MetricUnit.PER_MATCH,
            cap=ACES_CAP,
            sample=f"n={counts.matches_with_points}",
        ),
    ]
    return HeadToHeadDetail(
        **summary.model_dump(),
        hero=Metric(
            label=f"{summary.meetings} meeting{'s' if summary.meetings != 1 else ''} · "
            f"{summary.record.wins}–{summary.record.losses}",
            value=round(100 * summary.record.wins / summary.meetings),
            unit=MetricUnit.PERCENT,
            sample_size=f"n={summary.meetings}",
            baseline=None,
            delta=None,
            max=100,
            higher_is_better=True,
        ),
        results=[row.result for row in oldest_first],
        slope=_slope(db, player_id, oldest_first),
        loss_patterns=_loss_patterns(db, loss_ids, summary.record.losses),
        your_serve=[metric for metric in your_serve if metric is not None],
        their_serve=[metric for metric in their_serve if metric is not None],
        won_by_shot=won_by_shot,
        shot_frequency=shot_frequency,
    )
