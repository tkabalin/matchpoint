"""Response shapes for the player analytics endpoints (#172).

Nearly every number a dashboard tab renders is one `Metric`, matching the bullet-bar
component the web app draws them with, so the endpoints repeat one object rather than
inventing bespoke fields per statistic. Everything here is computed by the router from
stored rows, so no schema sets from_attributes and none has a request-body twin. A
field is null exactly when the data to compute it does not exist yet; zero would read
as a terrible score rather than an absent one.
"""

import enum
import uuid

from pydantic import BaseModel

from matchpoint_api.models import MatchResult


class MetricUnit(enum.StrEnum):
    """How a metric's value is scaled, so the client can label and cap it."""

    PERCENT = "percent"
    RATIO = "ratio"
    PER_SET = "per_set"
    PER_MATCH = "per_match"


# Each member below TIEBREAKS names a boolean the capture client already stamps on
# every point (`models/point.py`), so narrowing to one is a column test rather than a
# replay of the score. FULL is the absence of a filter and stamps nothing.
class PointPhase(enum.StrEnum):
    """Which stamped moment of a match a points query counts."""

    FULL = "full"
    TIEBREAKS = "tiebreaks"
    BREAK_POINTS = "break_points"
    GAME_POINTS = "game_points"
    SET_POINTS = "set_points"
    MATCH_POINTS = "match_points"
    GAME_ENDING = "game_ending"
    SET_ENDING = "set_ending"


class Metric(BaseModel):
    """One number a coach is shown, with everything needed to judge it."""

    label: str
    value: float
    unit: MetricUnit
    # Rendered verbatim next to the label ("n=14", "n=20 sets").
    sample_size: str
    # The comparison the value is judged against, in the same units.
    baseline: float | None
    # Change over the window, in the same units. Sign carries the direction.
    delta: float | None
    # Ceiling for the bar the value is drawn against.
    max: float
    # False for metrics like double faults, where down is the good direction.
    higher_is_better: bool
    # Set only where the value is not a plain number, e.g. a "3:0" ratio.
    display: str | None = None


class WinLossRecord(BaseModel):
    """Wins and losses, counted over matches with a recorded result."""

    wins: int
    losses: int


class BreakdownRow(BaseModel):
    """A labelled count in a horizontal bar list."""

    label: str
    value: int
    # Second stacked count where a row splits (forced alongside unforced).
    secondary_value: int | None = None
    # Ceiling the row's bar is drawn against, shared across the group.
    max: int


class ShotShare(BaseModel):
    """One radar axis: a shot type's share of one side's point-ending shots."""

    shot: str
    share: float


class PlayerOverview(BaseModel):
    """The overview tab: headline metrics and the win/loss record."""

    # Null until the player has a match with a recorded result.
    form: Metric | None
    # Most recent matches with a result, oldest first, at most five.
    recent_results: list[MatchResult]
    # These three are null until captured point data exists to compute them from.
    hold_percentage: Metric | None
    return_games_won: Metric | None
    forced_to_unforced: Metric | None
    season_record: WinLossRecord
    all_time_record: WinLossRecord


class FaultModeShares(BaseModel):
    """How one serve number's faults split between the three ways a serve misses.

    Percentages of that serve number's faults, each rounded on its own, so the three
    need not come to exactly 100.
    """

    net: float
    long: float
    wide: float


class FaultModeSplit(BaseModel):
    """A side's fault modes, split by serve number.

    A half is null until that serve number has faulted, and both are null on the
    returning side throughout: capture records where the tracked player's own serve
    missed and nothing at all about the opponent's.
    """

    first_serve: FaultModeShares | None
    second_serve: FaultModeShares | None


class ServeOutcomeShares(BaseModel):
    """How one serve number's attempts split between the three ways one lands.

    Three disjoint percentages totalling 100, so `landed` counts a serve that went in
    without being an ace. The share of that serve number that landed in at all, the
    figure the card headlines, is `landed + ace`.
    """

    landed: float
    fault: float
    ace: float


class ServeOutcomeSplit(BaseModel):
    """A side's serve outcomes, split by serve number.

    Whoever served on a side's points owns them, as the trend line does, so the
    returning card's describe the opponent's serve. A half is null until that serve
    number has been attempted.
    """

    first_serve: ServeOutcomeShares | None
    second_serve: ServeOutcomeShares | None


class ReturnOutcomeSplit(BaseModel):
    """The tracked player's own return outcomes, split by the serve returned.

    Percentages of that serve number's recorded returns. Empty on the serving side
    throughout: capture records the player's return of the opponent's serve and
    nothing about the opponent's return of theirs.
    """

    first_serve: list[BreakdownRow]
    second_serve: list[BreakdownRow]


class ServeTrendPoint(BaseModel):
    """One match's serve-in rates, as a point on the recent-matches trend line."""

    # A short axis label: "M1" is the oldest match in the series.
    match: str
    # The share of that serve number's attempts that landed in, aces included.
    first_serve_in: float
    # Null in a match where this side never went to a second serve.
    second_serve_in: float | None


class ServeSideStats(BaseModel):
    """One side of the serve tab, serving or returning."""

    # Null until a game-end point exists for this side's hero percentage.
    hero: Metric | None
    # Whichever of the side's metrics the stored points can answer.
    metrics: list[Metric]
    # How this side's points ended; empty until point data exists.
    breakdown: list[BreakdownRow]
    # How this side's serves landed, and how the faulted ones missed.
    outcome: ServeOutcomeSplit
    fault_mode: FaultModeSplit
    # How the player returned this side's serves.
    return_outcome: ReturnOutcomeSplit
    # This side's own serve-in rates, match by match and oldest first, so the
    # returning card's are the opponent's. At most one entry on a match-scoped
    # request, and none at all where this side never served.
    trend: list[ServeTrendPoint]


class ServeStats(BaseModel):
    """The serve tab, both sides in one payload."""

    serving: ServeSideStats
    returning: ServeSideStats


class OutcomeMixRow(BaseModel):
    """How the points one side decided split between their forcing shots and errors.

    Percentages of the rally-ended points that side's own last shot settled. A clean
    winner counts as forced: capture records no distinction between the two (#175).
    """

    label: str
    forced: float
    unforced: float


class PointEnderKind(enum.StrEnum):
    """Which of the three ways a rally-ending point ended a style card counts."""

    FORCED = "forced"
    UNFORCED = "unforced"
    UNUSUAL = "unusual"


class WingSplit(BaseModel):
    """One style's setup shots, counted by the wing they were struck off."""

    forehand: int
    backhand: int


class CourtZoneCount(BaseModel):
    """How many of a style's final balls landed in one zone of the court.

    Seven zones: the four in-court cells, deuce or ad by short or deep, and the
    three ways a ball goes out, net, long and wide.
    """

    zone: str
    count: int


class PointEnderStyleDetail(BaseModel):
    """What one style's points looked like, where there is anything to describe.

    Wing and shot type are the last successful shot (#175); the zone is where the
    final ball landed, a different fact. A point that recorded neither, a missed
    return among them, still counts toward the style and appears in no breakdown.
    """

    # Null exactly on the unusual style, which is how the card knows it is that one.
    wing: WingSplit | None
    shot_type: list[BreakdownRow]
    court_zones: list[CourtZoneCount]
    # Set only where wing is null: what kind of unusual point each one was.
    unusual_reasons: list[BreakdownRow] | None


class PointEnderStyle(BaseModel):
    """One point-ender card, with the drill-down behind it."""

    kind: PointEnderKind
    # Names which side applied the pressure or gave the point away, so the wording
    # swaps between the two halves of the toggle.
    label: str
    count: int
    detail: PointEnderStyleDetail


class PointEnderStyles(BaseModel):
    """Point enders for both halves of the won/lost toggle.

    `you` counts the points the player won and `opponents` the ones they lost, each
    as three styles in the order forced, unforced, unusual. Aces and double faults
    are serve endings and belong to the serve tab, so a side's three counts
    deliberately fall short of its points.
    """

    you: list[PointEnderStyle]
    opponents: list[PointEnderStyle]


class ShotFrequencySides(BaseModel):
    """The radar's shares for both halves of the won/lost toggle.

    `you` describes the shots that won the player points and `opponents` the shots
    they lost points to, each a share of that side's own total.
    """

    you: list[ShotShare]
    opponents: list[ShotShare]


class RallyLengthBucket(BaseModel):
    """How many points ran to roughly this many shots before ending.

    Not scoped to who won them: the read this exists for, serve and return pressure
    against fitness, cuts across that.
    """

    label: str
    count: int


class RallyStats(BaseModel):
    """The rally tab: how points end once the ball is in play.

    The stored shot is the last successful one, so `won_by_shot` describes the
    player's own point-winning shots and `lost_by_shot` the opponent's shots the
    player lost points on, never the player's own misses (#175).
    """

    hero: Metric | None
    # Every point the player won and lost, aces and double faults included, so the
    # two deliberately outrun the styles below, which count rally endings alone.
    won: int
    lost: int
    won_by_shot: list[BreakdownRow]
    lost_by_shot: list[BreakdownRow]
    outcome_mix: list[OutcomeMixRow]
    styles: PointEnderStyles
    errors_under_pressure: Metric | None
    errors_overall: Metric | None
    shot_frequency: ShotFrequencySides
    # The four buckets whole, or empty while no point carries one.
    rally_length: list[RallyLengthBucket]


class TrackedStatKey(enum.StrEnum):
    """Which statistic one tracked-stat row carries."""

    FORCED_TO_UNFORCED = "forced_to_unforced"
    FIRST_SERVE_IN = "first_serve_in"


class TrackedStat(BaseModel):
    """One statistic's latest value beside the player's own recent baseline.

    Both stats here are oriented so a higher `current` is the better direction, which
    is what lets the client read a value below the mean as worse than usual for this
    player whichever stat it belongs to.
    """

    key: TrackedStatKey
    label: str
    unit: MetricUnit
    current: float
    # This player's own recent average and spread, never the squad's and never a
    # fixed target. Zero spread where the baseline matches never differed.
    rolling_mean: float
    rolling_std_dev: float


class CurrentStreak(BaseModel):
    """The latest result, and how many matches in a row it has run for."""

    outcome: MatchResult
    length: int


class SquadMemberStats(BaseModel):
    """One roster player's raw figures, for both screens that rank a whole squad.

    Inputs and never a verdict: which of these amounts to needing attention (#204),
    or to first place on the Squad stats leaderboard (#237), is the client's rule, so
    the thresholds live there and the windows live here.
    """

    player_id: uuid.UUID
    # Matches played this calendar year, whether or not a result was recorded.
    matches_logged_this_period: int
    # This period's matches that carry a result. A count, so zero is the truth
    # rather than a stand-in, unlike the two rates below.
    period_record: WinLossRecord
    # The most recent results, oldest first, at most five, as PlayerOverview's are.
    last5: list[MatchResult]
    # Over this period's matches; null until a rally has ended either way.
    forced_to_unforced_ratio: float | None
    # Over this period's points; null until the player has served a first serve.
    first_serve_in_percent: float | None
    # Null until one match carries a result, there being no run to measure.
    current_streak: CurrentStreak | None
    # Counted over every match, resulted or not: staleness is about data entry.
    days_since_last_match: int | None
    # Only the stats this player has the matches to have a baseline for.
    tracked_stats: list[TrackedStat]


class SquadMetric(enum.StrEnum):
    """Which roster-wide figure a squad trend series carries."""

    RECORD = "record"
    FORCED_TO_UNFORCED = "forced_to_unforced"
    FIRST_SERVE_IN = "first_serve_in"


class SquadTrendPoint(BaseModel):
    """One week of the roster-wide trend line."""

    # A short axis label: "Wk 1" is the oldest week in the series.
    week: str
    # Null in a week the roster's matches cannot answer the metric over, an empty
    # week among them, so the line breaks there instead of dropping to the floor.
    value: float | None
