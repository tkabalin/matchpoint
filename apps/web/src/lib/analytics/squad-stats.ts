import { MIN_MATCHES_FOR_FORM_RANK } from "./attention";
import type {
  SquadHeadline,
  SquadHistogramBucket,
  SquadLeaderboardRow,
  SquadMetricKey,
  SquadStatsEntry,
} from "./types.provisional";
import { formatRecord } from "@/lib/format-record";
import type { CategoryName } from "@/lib/palette";

/**
 * The pure ranking/bucketing/averaging logic behind the Squad stats page —
 * no React, no fetch, mirroring `attention.ts`'s own shape. Below-threshold
 * players never get a fabricated rank or value; they're a separate group the
 * caller renders differently, not filtered out silently.
 */

// Same threshold, same reasoning as the home screen's best/worst form
// ranking: below this many matches this period, a rank would be swung by a
// single result.
export const MIN_MATCHES_FOR_SQUAD_RANK = MIN_MATCHES_FOR_FORM_RANK;

/** One safe non-outcome color per metric, shared by the Spread histogram and
 *  the Trend card so "Forced : Unforced" is always the same color wherever
 *  it appears on this page — see `.claude/rules/web-color.md`'s Squad stats
 *  entry. Never blue: the bottom nav is visible on this page. */
export const METRIC_PATTERN: Record<SquadMetricKey, CategoryName> = {
  record: "yellow",
  forcedToUnforced: "indigo",
  firstServe: "violet",
};

const HISTOGRAM_BUCKET_COUNT = 5;

type NamedEntry = SquadStatsEntry & { name: string };

export function winPercent(entry: Pick<SquadStatsEntry, "wins" | "losses">): number {
  const total = entry.wins + entry.losses;
  return total === 0 ? 0 : (entry.wins / total) * 100;
}

export function metricValue(entry: SquadStatsEntry, key: SquadMetricKey): number {
  if (key === "record") return winPercent(entry);
  if (key === "forcedToUnforced") return entry.forcedToUnforcedRatio;
  return entry.firstServeInPercent;
}

export function metricDisplay(entry: SquadStatsEntry, key: SquadMetricKey): string {
  if (key === "record") return formatRecord(entry.wins, entry.losses);
  if (key === "forcedToUnforced") return metricValue(entry, key).toFixed(2);
  return `${Math.round(metricValue(entry, key))}%`;
}

/** Squad-wide aggregates for the headline card. Record sums wins/losses
 *  across the roster rather than averaging each player's own win% — an
 *  average of percentages would weight a 1-match player the same as a
 *  10-match one. */
export function squadHeadline(entries: SquadStatsEntry[]): SquadHeadline {
  const wins = entries.reduce((sum, entry) => sum + entry.wins, 0);
  const losses = entries.reduce((sum, entry) => sum + entry.losses, 0);
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

  return {
    record: { wins, losses },
    forcedToUnforcedRatio: mean(entries.map((entry) => entry.forcedToUnforcedRatio)),
    firstServeInPercent: mean(entries.map((entry) => entry.firstServeInPercent)),
  };
}

function bySearch(entries: NamedEntry[], search: string): NamedEntry[] {
  const query = search.trim().toLowerCase();
  return query ? entries.filter((entry) => entry.name.toLowerCase().includes(query)) : entries;
}

/** Entries at or above the ranking threshold, after the search filter —
 *  shared by `buildLeaderboard` and the spread histogram, which buckets
 *  exactly this same ranked set. */
export function rankedOnly(entries: NamedEntry[], search: string): NamedEntry[] {
  return bySearch(entries, search).filter(
    (entry) => entry.matchesLoggedThisPeriod >= MIN_MATCHES_FOR_SQUAD_RANK,
  );
}

/** Ranked rows (>= threshold matches, sorted desc by the selected metric)
 *  first, then unranked rows (< threshold, `metricValue`/`rank` null, shown
 *  dimmed with a match count instead) — search filters both groups by name
 *  before ranking. */
export function buildLeaderboard(
  entries: NamedEntry[],
  key: SquadMetricKey,
  search: string,
): SquadLeaderboardRow[] {
  const filtered = bySearch(entries, search);

  const ranked = rankedOnly(entries, search).sort(
    (a, b) => metricValue(b, key) - metricValue(a, key),
  );
  const unranked = filtered.filter(
    (entry) => entry.matchesLoggedThisPeriod < MIN_MATCHES_FOR_SQUAD_RANK,
  );

  return [
    ...ranked.map((entry, index) => ({
      playerId: entry.playerId,
      name: entry.name,
      metricValue: metricValue(entry, key),
      matchesLoggedThisPeriod: entry.matchesLoggedThisPeriod,
      rank: index + 1,
    })),
    ...unranked.map((entry) => ({
      playerId: entry.playerId,
      name: entry.name,
      metricValue: null,
      matchesLoggedThisPeriod: entry.matchesLoggedThisPeriod,
      rank: null,
    })),
  ];
}

/** Buckets the ranked (threshold-eligible) players' values for the selected
 *  metric into 5 equal-width buckets between their own min/max — always fed
 *  by the leaderboard's own metric, never independently selectable. */
export function buildHistogram(
  rankedEntries: SquadStatsEntry[],
  key: SquadMetricKey,
): SquadHistogramBucket[] {
  const values = rankedEntries.map((entry) => metricValue(entry, key));
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / HISTOGRAM_BUCKET_COUNT || 1; // guard: every value equal

  const buckets = Array.from({ length: HISTOGRAM_BUCKET_COUNT }, (_, index) => ({
    lo: min + index * width,
    hi: index === HISTOGRAM_BUCKET_COUNT - 1 ? max : min + (index + 1) * width,
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(HISTOGRAM_BUCKET_COUNT - 1, Math.floor((value - min) / width));
    buckets[index]!.count += 1;
  }

  const format = (n: number) => (key === "forcedToUnforced" ? n.toFixed(2) : `${Math.round(n)}%`);
  return buckets.map((bucket) => ({
    label: `${format(bucket.lo)}–${format(bucket.hi)}`,
    count: bucket.count,
  }));
}
