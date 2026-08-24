"""Response shapes for the player analytics endpoints (#172).

Nearly every number a dashboard tab renders is one `Metric`, matching the bullet-bar
component the web app draws them with, so the endpoints repeat one object rather than
inventing bespoke fields per statistic. Everything here is computed by the router from
stored rows, so no schema sets from_attributes and none has a request-body twin. A
field is null exactly when the data to compute it does not exist yet; zero would read
as a terrible score rather than an absent one.
"""

import enum

from pydantic import BaseModel

from matchpoint_api.models import MatchResult


class MetricUnit(enum.StrEnum):
    """How a metric's value is scaled, so the client can label and cap it."""

    PERCENT = "percent"
    RATIO = "ratio"
    PER_SET = "per_set"
    PER_MATCH = "per_match"


class TrendWindow(enum.StrEnum):
    """Which slice of a player's most recent matches a trends query covers."""

    LAST5 = "last5"
    LAST10 = "last10"
    SEASON = "season"


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
    """One radar axis: a shot type's share of the player's point-winning shots."""

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
    # How this side's faulted serves missed.
    fault_mode: FaultModeSplit
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

    Nine zones: the six in-court cells, deuce or ad by short, mid or deep, and the
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


class RallyStats(BaseModel):
    """The rally tab: how points end once the ball is in play.

    The stored shot is the last successful one, so `won_by_shot` describes the
    player's own point-winning shots and `lost_by_shot` the opponent's shots the
    player lost points on, never the player's own misses (#175).
    """

    hero: Metric | None
    won_by_shot: list[BreakdownRow]
    lost_by_shot: list[BreakdownRow]
    outcome_mix: list[OutcomeMixRow]
    styles: PointEnderStyles
    errors_under_pressure: Metric | None
    errors_overall: Metric | None
    shot_frequency: list[ShotShare]


class DistributionBucket(BaseModel):
    """One histogram bar: how many of the window's matches fell in this range."""

    bucket: str
    matches: int


class CorrelationPoint(BaseModel):
    """One match on the unforced-errors vs games-lost scatter."""

    unforced_errors: int
    games_lost: int


class TrendStats(BaseModel):
    """The trends tab, computed over the requested window of recent matches."""

    metrics: list[Metric]
    distribution_label: str
    distribution: list[DistributionBucket]
    correlation: list[CorrelationPoint]


class HeadToHeadSummary(BaseModel):
    """One opponent row on the head-to-head list."""

    # The normalised name that keys this matchup, used as the detail path segment.
    opponent_key: str
    # The most recent spelling the coach used for the name.
    opponent_name: str
    meetings: int
    record: WinLossRecord
    # Null below the sample-size floor, where a rate would mislead.
    win_rate: float | None


class SlopeLine(BaseModel):
    """One metric's first-two vs last-two meeting average, drawn as a slope line."""

    label: str
    first: float
    last: float


class HeadToHeadDetail(HeadToHeadSummary):
    """The full matchup view against one opponent."""

    hero: Metric
    # Meeting by meeting, oldest first.
    results: list[MatchResult]
    # Exactly three lines when present; null until four meetings carry the point
    # data every line needs, so the chart never draws a half-computed comparison.
    slope: list[SlopeLine] | None
    loss_patterns: list[BreakdownRow]
    your_serve: list[Metric]
    their_serve: list[Metric]
    won_by_shot: list[BreakdownRow]
    shot_frequency: list[ShotShare]
