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


class ServeSideStats(BaseModel):
    """One side of the serve tab, serving or returning."""

    # Null until a game-end point exists for this side's hero percentage.
    hero: Metric | None
    # Whichever of the side's metrics the stored points can answer.
    metrics: list[Metric]
    # How this side's points ended; empty until point data exists.
    breakdown: list[BreakdownRow]


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
