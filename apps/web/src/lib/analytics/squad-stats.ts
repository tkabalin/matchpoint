import type {
  PointEnderKind,
  PointEnderStyle,
  PointEnderStyles,
  RallyStats,
  SquadMemberStats,
  SquadTrendPoint,
} from "@matchpoint/api-client";
import { CircleCheck, type LucideIcon, Swords, Trophy } from "lucide-react";

import type {
  SquadHeadline,
  SquadLeaderboardRow,
  SquadMetricKey,
  SquadStatsEntry,
} from "./types.provisional";
import type { CategoryName } from "@/lib/palette";

/**
 * The pure ranking/averaging logic behind the Squad stats page — no React
 * hooks, no fetch, mirroring `attention.ts`'s own shape. `METRIC_ICON` below
 * is metadata only (which component to reach for), not JSX, so it doesn't
 * break that: nothing here renders.
 */

/** One safe non-outcome color per metric, shared by the trend card and the
 *  leaderboard's own percentage bars so a metric is always the same color
 *  wherever it appears on this page — see `.claude/rules/web-color.md`'s
 *  Squad stats entry. Never blue: the bottom nav is visible on this page.
 *  Forced:unforced is the one exception — its chip is a genuine outcome pair
 *  (forced/unforced error), so it keeps the outcome palette instead of this
 *  categorical one, the same as the player card's own needle. */
export const METRIC_PATTERN: Record<SquadMetricKey, CategoryName> = {
  record: "yellow",
  forcedToUnforced: "indigo",
  firstServe: "violet",
};

/** Single source of truth for how each metric is named — the leaderboard and
 *  trend card used to keep their own separate copies, which had already
 *  drifted ("Record" vs. "Record (win %)"). One label, everywhere. */
export const METRIC_LABEL: Record<SquadMetricKey, string> = {
  record: "Win percentage",
  forcedToUnforced: "Forced : Unforced",
  firstServe: "First serves landing in play",
};

/** Same icon each metric already carries elsewhere in the app
 *  (`.claude/rules/web-icons.md`) — the filter chip that picks a metric
 *  should look like the same concept, not introduce a fourth meaning for the
 *  shape. */
export const METRIC_ICON: Record<SquadMetricKey, LucideIcon> = {
  record: Trophy,
  forcedToUnforced: Swords,
  firstServe: CircleCheck,
};

type NamedEntry = SquadStatsEntry & { name: string };

export function winPercent(entry: Pick<SquadStatsEntry, "wins" | "losses">): number {
  const total = entry.wins + entry.losses;
  return total === 0 ? 0 : (entry.wins / total) * 100;
}

export function metricValue(entry: SquadStatsEntry, key: SquadMetricKey): number | null {
  if (key === "record") return winPercent(entry);
  if (key === "forcedToUnforced") return entry.forcedToUnforcedRatio;
  return entry.firstServeInPercent;
}

/** The leaderboard always displays the number it sorts by — "record" used to
 *  show the "W–L" string while ranking on win %, so a 3–2 (60%) player could
 *  outrank a displayed 5–5 one. Forced:unforced is the one metric the
 *  leaderboard renders differently (the split counts plus a weight visual,
 *  not this string) — this stays the ratio for anything that still wants a
 *  single comparable number from it. */
export function metricDisplay(entry: SquadStatsEntry, key: SquadMetricKey): string {
  if (key === "record") return `${Math.round(winPercent(entry))}%`;
  const value = metricValue(entry, key);
  if (value === null) return "—";
  return key === "forcedToUnforced" ? value.toFixed(2) : `${Math.round(value)}%`;
}

/** Each entry's own rate, weighted by its own `matchesLoggedThisPeriod`. The
 *  API pools `firstServeInPercent` from the real point counts behind one
 *  player's own matches, but doesn't ship those counts back for a second,
 *  squad-wide pooling pass — match count is the closest available stand-in,
 *  better than an unweighted mean that treats a 1-match player the same as a
 *  regular starter. Null rates (nobody with a computable rate yet) are
 *  excluded rather than treated as zero. */
function weightedMean(
  entries: SquadStatsEntry[],
  value: (entry: SquadStatsEntry) => number | null,
): number | null {
  const weighed = entries.filter(
    (entry) => value(entry) !== null && entry.matchesLoggedThisPeriod > 0,
  );
  const totalMatches = weighed.reduce((sum, entry) => sum + entry.matchesLoggedThisPeriod, 0);
  if (totalMatches === 0) return null;
  const sum = weighed.reduce(
    (acc, entry) => acc + value(entry)! * entry.matchesLoggedThisPeriod,
    0,
  );
  return sum / totalMatches;
}

/** Squad-wide aggregates for the headline card. Record sums wins/losses, and
 *  forced/unforced sum the raw counts too — both are genuine totals, not
 *  rates, so a plain sum is the right pooling, unlike first-serve % below
 *  which needs a weighted mean since it only exists as a per-player rate.
 *  `matchesThisPeriod` is the card's own scope caption: the true per-stat
 *  denominators a real pooled rate would need aren't on this payload (#249),
 *  so the match count is what tells a coach how much the other numbers are
 *  actually standing on. */
export function squadHeadline(entries: SquadStatsEntry[]): SquadHeadline {
  const wins = entries.reduce((sum, entry) => sum + entry.wins, 0);
  const losses = entries.reduce((sum, entry) => sum + entry.losses, 0);

  return {
    record: { wins, losses },
    forcedCount: entries.reduce((sum, entry) => sum + entry.forcedCount, 0),
    unforcedCount: entries.reduce((sum, entry) => sum + entry.unforcedCount, 0),
    firstServeInPercent: weightedMean(entries, (entry) => entry.firstServeInPercent),
    matchesThisPeriod: entries.reduce((sum, entry) => sum + entry.matchesLoggedThisPeriod, 0),
  };
}

function bySearch(entries: NamedEntry[], search: string): NamedEntry[] {
  const query = search.trim().toLowerCase();
  return query ? entries.filter((entry) => entry.name.toLowerCase().includes(query)) : entries;
}

/** Every entry, sorted desc by the selected metric — no minimum-matches
 *  threshold: a coach with a small squad, or a player just getting started,
 *  still wants to see where everyone stands. A null metric value (nobody has
 *  a computable rate yet) sorts last rather than being excluded, and reads
 *  as "—" rather than a fabricated number. */
export function buildLeaderboard(
  entries: NamedEntry[],
  key: SquadMetricKey,
  search: string,
): SquadLeaderboardRow[] {
  const filtered = bySearch(entries, search);
  const sorted = [...filtered].sort(
    (a, b) => (metricValue(b, key) ?? -Infinity) - (metricValue(a, key) ?? -Infinity),
  );

  return sorted.map((entry, index) => ({
    playerId: entry.playerId,
    name: entry.name,
    metricValue: metricValue(entry, key),
    matchesLoggedThisPeriod: entry.matchesLoggedThisPeriod,
    rank: index + 1,
  }));
}

/** Carries a week's value forward across an interior gap — a week nobody
 *  logged a match in isn't "no data changed," it's "no update happened," so
 *  the last real value still stands. Never fabricates a leading run before
 *  the first real value — there's nothing yet to carry. Never gates on how
 *  many players/matches stood behind the carried value; the API's own
 *  null-vs-value split is already the only sample-size signal this page
 *  uses. `carriedIndices` is what lets the chart draw a carried point
 *  differently (a hollow dot) from a real one, so a flat stretch never reads
 *  as "the squad held steady" when nobody actually played that week. */
export function fillSquadTrendGaps(trend: SquadTrendPoint[]): {
  trend: SquadTrendPoint[];
  carriedIndices: Set<number>;
} {
  let lastValue: number | null = null;
  const carriedIndices = new Set<number>();
  const filled = trend.map((point, index) => {
    if (point.value !== null) {
      lastValue = point.value;
      return point;
    }
    if (lastValue === null) return point;
    carriedIndices.add(index);
    return { ...point, value: lastValue };
  });
  return { trend: filled, carriedIndices };
}

function styleCount(styles: PointEnderStyle[], kind: PointEnderKind): number {
  return styles.find((style) => style.kind === kind)?.count ?? 0;
}

/** Own forced errors / (own forced + own unforced) × 100 — `styles.opponents`
 *  is deliberately the source, not `styles.you`: those are the points the
 *  tracked player *lost*, so both its forced and unforced counts describe an
 *  error the tracked player themselves made (forced upon them, or their own
 *  unforced mistake), which is exactly what "own errors" means here. Null
 *  when neither has happened yet — nothing to compute a share from. */
export function mistakeResilience(styles: PointEnderStyles): number | null {
  const forced = styleCount(styles.opponents, "forced");
  const unforced = styleCount(styles.opponents, "unforced");
  const total = forced + unforced;
  return total === 0 ? null : (forced / total) * 100;
}

/** Errors forced onto the opponent / (opponent's forced errors + opponent's
 *  own unforced errors) × 100 — one shared quantity (the opponent's own
 *  forced-error count) as both the whole numerator and the first term of the
 *  denominator, the same "share of total" shape `mistakeResilience` has.
 *  `styles.you` is the source: those are the points the tracked player *won*,
 *  so both its forced and unforced counts describe an error the *opponent*
 *  made — forced by the tracked player's own pressure, or the opponent's own
 *  free mistake. Null when neither has happened yet. */
export function aggressionScore(styles: PointEnderStyles): number | null {
  const forced = styleCount(styles.you, "forced");
  const unforced = styleCount(styles.you, "unforced");
  const total = forced + unforced;
  return total === 0 ? null : (forced / total) * 100;
}

/** One overall average rally length (in shots), from `RallyStats`'s own
 *  won/lost split — weighted by how many points backed each side (`won`/
 *  `lost`), not a plain mean of the two, so a player with far more won
 *  points than lost ones isn't skewed by the lost side's average as much as
 *  the won side. Null only when both sides are null (no rally-ending points
 *  recorded at all yet). */
export function overallAverageRallyLength(
  rally: Pick<RallyStats, "average_rally_length" | "won" | "lost">,
): number | null {
  const { won, lost } = rally.average_rally_length;
  if (won === null && lost === null) return null;
  if (won === null) return lost;
  if (lost === null) return won;
  const totalPoints = rally.won + rally.lost;
  if (totalPoints === 0) return (won + lost) / 2;
  return (won * rally.won + lost * rally.lost) / totalPoints;
}

const SIZE_BUCKETS = ["sm", "md", "lg", "xl"] as const;

export type RallyLengthSize = (typeof SIZE_BUCKETS)[number];

/** Buckets a value into one of the four avatar sizes, relative to the
 *  group's own min/max — never an absolute threshold, since "a long rally"
 *  only means something relative to this squad's own spread. A flat
 *  distribution (`min === max`, including a group of one) maps everyone to
 *  `"md"` rather than implying variation that isn't there. */
export function rallyLengthSizeBucket(value: number, min: number, max: number): RallyLengthSize {
  if (min === max) return "md";
  const share = (value - min) / (max - min);
  const index = Math.min(SIZE_BUCKETS.length - 1, Math.floor(share * SIZE_BUCKETS.length));
  return SIZE_BUCKETS[index]!;
}

// Grid coordinates stay inside this band, not the full 0-100: an avatar
// centered exactly on the 0 or 100 edge would render half off the grid.
const POSITION_PADDING = 10;

/** Rescales a value to a 10-90 position using the *plotted group's own*
 *  min/max, not the raw 0-100 score — a squad clustered tightly around one
 *  score (e.g. everyone at 45-55% aggression) would otherwise pile up as
 *  overlapping avatars in the grid's center. Same "relative to this squad's
 *  own spread, never an absolute threshold" reasoning as
 *  `rallyLengthSizeBucket` above, applied to position instead of size. A flat
 *  distribution (`min === max`, including a group of one) maps to the exact
 *  center (50) rather than implying a spread that isn't there. Two players
 *  with genuinely identical scores on both axes still land on the same
 *  point — this spreads out a *distribution*, it doesn't guarantee no two
 *  points ever coincide. */
export function scaleToGroupRange(value: number, min: number, max: number): number {
  if (min === max) return 50;
  const share = (value - min) / (max - min);
  return POSITION_PADDING + share * (100 - 2 * POSITION_PADDING);
}

/** The two ends of a squad ranked by one metric. Entries whose `value` is
 *  null are excluded entirely, matching every other ranking on this page:
 *  nothing to rank without a computable number. A lone eligible entry (or
 *  every eligible entry tied) comes back as `best` only, never duplicated as
 *  `worst` too, so a squad of one doesn't imply a spread that isn't there. */
export function pickBestWorst<T>(
  entries: T[],
  value: (entry: T) => number | null,
): { best: T | null; worst: T | null } {
  const eligible = entries.filter((entry) => value(entry) !== null);
  if (eligible.length === 0) return { best: null, worst: null };
  const sorted = [...eligible].sort((a, b) => value(b)! - value(a)!);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  // Value equality, not object identity: a genuine tie across two different
  // players is exactly as much "no real spread" as a single eligible entry
  // compared against itself.
  return { best, worst: value(best) === value(worst) ? null : worst };
}

/** Win percent over a player's own current-period record — the same shape as
 *  `winPercent` above, but null instead of 0 when nobody's played a match
 *  this period yet: `pickBestWorst` needs to tell "genuinely 0%" apart from
 *  "no data", which the Squad stats leaderboard `winPercent` feeds never has
 *  to (every leaderboard row is already a player with a real record). Every
 *  Home ranking reads this period-wide record rather than a fixed last-N
 *  window, so a squad with nobody on a 5-match streak yet still ranks
 *  meaningfully instead of the rows going empty. */
export function periodWinPercent(
  record: Pick<SquadMemberStats["period_record"], "wins" | "losses">,
): number | null {
  const total = record.wins + record.losses;
  return total === 0 ? null : (record.wins / total) * 100;
}

/** Forced errors suffered / (forced errors suffered + unforced errors) × 100,
 *  over a player's own current period — the same "share of total" shape
 *  `mistakeResilience` above has, scoped to `period_forced_errors_suffered`/
 *  `period_unforced_errors` rather than a player's whole history.
 *  `forced_errors_suffered` is forced upon this player by the opponent;
 *  `unforced_errors` is this player's own free mistakes, so a high share
 *  means most of their errors were the opponent's doing rather than their
 *  own — steady, not sloppy. Null when neither has happened this period. */
export function periodResiliencePercent(
  member: Pick<SquadMemberStats, "period_forced_errors_suffered" | "period_unforced_errors">,
): number | null {
  const total = member.period_forced_errors_suffered + member.period_unforced_errors;
  return total === 0 ? null : (member.period_forced_errors_suffered / total) * 100;
}
