import type { ScoringSystem, Surface } from "@matchpoint/api-client";

export const SURFACE_LABEL: Record<Surface, string> = {
  hard: "Hard",
  clay: "Clay",
  grass: "Grass",
  carpet: "Carpet",
};

// "Women's Grand Slam" isn't its own entry — docs/scoring-systems.md records it as
// identical to Traditional in every rule, so Traditional's own label covers both.
export const SCORING_SYSTEM_LABEL: Record<ScoringSystem, string> = {
  traditional: "Traditional (Women's Grand Slam)",
  mens_grand_slam: "Men's Grand Slam",
  no_ad_scoring: "No-Ad Scoring",
  match_tiebreak_10_points: "Match Tiebreak (to 10)",
  short_sets: "Short Sets",
  pro_set: "Pro Set",
  legacy: "Legacy",
};

// One line each, source of truth is docs/scoring-systems.md — kept short enough to sit
// as helper text under a single Select rather than a full rules writeup.
export const SCORING_SYSTEM_DESCRIPTION: Record<ScoringSystem, string> = {
  traditional: "Deuce at 40-40, win by 2. Best of 3 sets, tiebreak at 6-6.",
  mens_grand_slam: "Same scoring as Traditional, but best of 5 sets.",
  no_ad_scoring: "Sudden death at 40-40 — next point wins the game outright.",
  match_tiebreak_10_points: "As Traditional, but the deciding set is a first-to-10 tiebreak.",
  short_sets: "No-ad scoring, sets to 4 games, tiebreak at 3-3. Built for short sessions.",
  pro_set: "One set to 8 games, win by 2, tiebreak at 8-8. Replaces a full match.",
  legacy: "As Traditional, but the deciding set has no tiebreak — win by 2 games instead.",
};
