import type { SquadMemberStats, TrackedStat } from "@matchpoint/api-client";

import type { AttentionResult } from "./types.provisional";

/**
 * The home screen's "needs attention" decision.
 *
 * Two tiers, checked in order, exactly one flag surfaced per player:
 *
 * Tier 1 — hard flags. A losing streak of `LOSING_STREAK_THRESHOLD` or more,
 * or no match ever logged. These are operational, not statistical: a coach
 * needs to know about them regardless of how any number is trending, so they
 * short-circuit Tier 2 entirely. Elapsed days alone no longer hard-flags —
 * a quiet fortnight isn't itself a problem, only ever logging nothing is.
 *
 * Tier 2 — only checked when Tier 1 didn't fire. For each tracked stat,
 * compute a z-score against the player's *own* rolling average — never the
 * squad average, never a fixed target — so a naturally streaky player's
 * ordinary swings don't trip it, but a genuine departure from their own
 * pattern does. Whichever stat has the most negative z-score becomes the
 * reason shown on the card. `tracked_stats` already only carries a stat with
 * a real baseline behind it — the endpoint skips one under two qualifying
 * matches — so no separate matches-logged gate belongs here; that gate used
 * to key on the calendar-year `matches_logged_this_period` counter, which
 * falsely starved Tier 2 for the first few matches of every January (#238).
 * A minimum severity (`DECLINE_Z_THRESHOLD`) still applies, so ordinary
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

export const DECLINE_Z_THRESHOLD = 1.5;

function hardFlagReason(member: SquadMemberStats): string | null {
  if (
    member.current_streak !== null &&
    member.current_streak.outcome === "loss" &&
    member.current_streak.length >= LOSING_STREAK_THRESHOLD
  ) {
    return `${member.current_streak.length}-match losing streak`;
  }
  // null means this player has never logged a match at all, distinct from a
  // recent player simply having gone quiet for a while (no longer flagged).
  if (member.days_since_last_match === null) {
    return "No matches logged yet";
  }
  return null;
}

function formatDecline(stat: TrackedStat): string {
  const diff = stat.current - stat.rolling_mean;
  const magnitude =
    stat.unit === "percent" ? `${Math.abs(Math.round(diff))}pts` : Math.abs(diff).toFixed(1);
  return `${stat.label} down ${magnitude} vs their own average`;
}

function largestDecline(member: SquadMemberStats): { stat: TrackedStat; z: number } | null {
  let worst: { stat: TrackedStat; z: number } | null = null;
  for (const stat of member.tracked_stats) {
    if (stat.rolling_std_dev === 0) continue; // no spread to have deviated from
    const z = (stat.current - stat.rolling_mean) / stat.rolling_std_dev;
    if (worst === null || z < worst.z) worst = { stat, z };
  }
  return worst;
}

/** One player's own attention flag, or `null` if neither tier fires. */
export function attentionFor(member: SquadMemberStats): AttentionResult | null {
  const hardFlag = hardFlagReason(member);
  if (hardFlag) {
    return { playerId: member.player_id, tier: "hard-flag", reason: hardFlag, severity: Infinity };
  }

  const decline = largestDecline(member);
  if (decline && decline.z <= -DECLINE_Z_THRESHOLD) {
    return {
      playerId: member.player_id,
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

    const recency = member.days_since_last_match ?? Number.POSITIVE_INFINITY;
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
