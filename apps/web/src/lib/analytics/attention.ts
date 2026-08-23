import type {
  AttentionResult,
  FormRankEntry,
  MatchOutcome,
  SquadMemberStats,
  TrackedStat,
} from "./types.provisional";

/**
 * The home screen's "needs attention" decision, and the best/worst form
 * ranking that sits alongside it in the squad snapshot.
 *
 * Two tiers, checked in order, exactly one flag surfaced per player:
 *
 * Tier 1 — hard flags. A losing streak of `LOSING_STREAK_THRESHOLD` or more,
 * or no match logged in `STALE_DATA_DAYS`+. These are operational, not
 * statistical: a coach needs to know about them regardless of how any number
 * is trending, so they short-circuit Tier 2 entirely.
 *
 * Tier 2 — only checked when Tier 1 didn't fire. For each tracked stat,
 * compute a z-score against the player's *own* rolling average — never the
 * squad average, never a fixed target — so a naturally streaky player's
 * ordinary swings don't trip it, but a genuine departure from their own
 * pattern does. Whichever stat has the most negative z-score becomes the
 * reason shown on the card. Requires both a minimum sample
 * (`MIN_MATCHES_FOR_BASELINE`, so there's an actual baseline to deviate
 * from) and a minimum severity (`DECLINE_Z_THRESHOLD`), so ordinary
 * week-to-week noise doesn't get flagged constantly and the feature stays
 * trustworthy.
 *
 * Across the whole squad, only one slot exists on the home card: whichever
 * player has the single highest severity wins. Tier 1 flags always outrank
 * Tier 2 ones (`severity: Infinity`); within Tier 2, severities are already
 * on the same normalised (|z|) scale, so they compare directly. Ties break
 * by recency, since "needs attention" should feel current.
 *
 * Most weeks, nobody should trip this — `pickSquadAttention` returning
 * `null` is a legitimate, expected result, not a bug: a card that always has
 * something to show stops being read as signal and starts being read as
 * decoration.
 */

export const LOSING_STREAK_THRESHOLD = 3;
export const STALE_DATA_DAYS = 14;

export const MIN_MATCHES_FOR_BASELINE = 5;
export const DECLINE_Z_THRESHOLD = 1.5;

/** Below this many matches this period, a form ranking would be swung by a
 *  single result — not enough sample to call it a rank. */
export const MIN_MATCHES_FOR_FORM_RANK = 3;

function hardFlagReason(member: SquadMemberStats): string | null {
  if (
    member.currentStreak.outcome === "loss" &&
    member.currentStreak.length >= LOSING_STREAK_THRESHOLD
  ) {
    return `${member.currentStreak.length}-match losing streak`;
  }
  if (member.daysSinceLastMatch === null || member.daysSinceLastMatch >= STALE_DATA_DAYS) {
    return "No matches logged in 14+ days";
  }
  return null;
}

function formatDecline(stat: TrackedStat): string {
  const diff = stat.current - stat.rollingMean;
  const magnitude =
    stat.unit === "percent" ? `${Math.abs(Math.round(diff))}pts` : Math.abs(diff).toFixed(1);
  return `${stat.label} down ${magnitude} vs their own average`;
}

function largestDecline(member: SquadMemberStats): { stat: TrackedStat; z: number } | null {
  if (member.matchesLoggedThisPeriod < MIN_MATCHES_FOR_BASELINE) return null;

  let worst: { stat: TrackedStat; z: number } | null = null;
  for (const stat of member.trackedStats) {
    if (stat.rollingStdDev === 0) continue; // no spread to have deviated from
    const z = (stat.current - stat.rollingMean) / stat.rollingStdDev;
    if (worst === null || z < worst.z) worst = { stat, z };
  }
  return worst;
}

/** One player's own attention flag, or `null` if neither tier fires. */
export function attentionFor(member: SquadMemberStats): AttentionResult | null {
  const hardFlag = hardFlagReason(member);
  if (hardFlag) {
    return { playerId: member.playerId, tier: "hard-flag", reason: hardFlag, severity: Infinity };
  }

  const decline = largestDecline(member);
  if (decline && decline.z <= -DECLINE_Z_THRESHOLD) {
    return {
      playerId: member.playerId,
      tier: "decline",
      reason: formatDecline(decline.stat),
      severity: Math.abs(decline.z),
    };
  }

  return null;
}

/** The squad's single "needs attention" slot — highest severity wins, ties
 *  break by recency (fewer days since their last match). */
export function pickSquadAttention(members: SquadMemberStats[]): AttentionResult | null {
  let winner: { result: AttentionResult; recency: number } | null = null;

  for (const member of members) {
    const result = attentionFor(member);
    if (!result) continue;

    const recency = member.daysSinceLastMatch ?? Number.POSITIVE_INFINITY;
    if (
      winner === null ||
      result.severity > winner.result.severity ||
      (result.severity === winner.result.severity && recency < winner.recency)
    ) {
      winner = { result, recency };
    }
  }

  return winner?.result ?? null;
}

function recordFrom(results: MatchOutcome[]): string {
  const wins = results.filter((result) => result === "win").length;
  return `${wins}–${results.length - wins}`;
}

function toFormRankEntry(member: SquadMemberStats): FormRankEntry {
  return {
    playerId: member.playerId,
    last5Record: recordFrom(member.last5),
    forcedToUnforcedRatio: member.forcedToUnforcedRatio,
  };
}

/** Best/worst current form across the squad, ranked by forced:unforced ratio among
 *  players with `MIN_MATCHES_FOR_FORM_RANK`+ matches logged this period. */
export function rankForm(members: SquadMemberStats[]): {
  best: FormRankEntry | null;
  worst: FormRankEntry | null;
} {
  const eligible = members.filter(
    (member) => member.matchesLoggedThisPeriod >= MIN_MATCHES_FOR_FORM_RANK,
  );
  if (eligible.length === 0) return { best: null, worst: null };

  const sorted = [...eligible].sort((a, b) => b.forcedToUnforcedRatio - a.forcedToUnforcedRatio);
  const bestMember = sorted[0]!;
  const worstMember = sorted[sorted.length - 1]!;

  return {
    best: toFormRankEntry(bestMember),
    // A single eligible player is both the best and worst performer, which
    // isn't a real comparison — show them once, as best, rather than twice.
    worst: bestMember === worstMember ? null : toFormRankEntry(worstMember),
  };
}
