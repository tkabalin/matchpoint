import type { ScoringSystem, Surface } from "@matchpoint/api-client";

export const SURFACE_LABEL: Record<Surface, string> = {
  hard: "Hard",
  clay: "Clay",
  grass: "Grass",
  carpet: "Carpet",
};

export const SCORING_SYSTEM_LABEL: Record<ScoringSystem, string> = {
  traditional: "Traditional",
  mens_grand_slam: "Men's Grand Slam",
  womens_grand_slam: "Women's Grand Slam",
  no_ad_scoring: "No-Ad Scoring",
  match_tiebreak_10_points: "Match Tiebreak (to 10)",
  short_sets: "Short Sets",
  pro_set: "Pro Set",
  legacy: "Legacy",
};
