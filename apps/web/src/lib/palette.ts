/**
 * The categorical palette from `.claude/rules/web-color.md`, as the class names that
 * pair each color with its required pattern (see `pattern-*` in `app.css`).
 *
 * Split into two maps on purpose: that rule reserves the outcome colors for point
 * outcomes and hero score bands, so a component that wants a general category color
 * can take `CategoryName` and be unable to reach for them by accident.
 */

/** Point outcomes and good/neutral/bad score bands. Nothing else. */
export type OutcomeName = "win" | "forced" | "unforced";

/** Free for any categorical distinction that isn't an outcome. */
export type CategoryName = "yellow" | "indigo" | "violet" | "sky";

export type PatternName = OutcomeName | CategoryName;

export const PATTERN_CLASS: Record<PatternName, string> = {
  win: "pattern-win",
  forced: "pattern-forced",
  unforced: "pattern-unforced",
  yellow: "pattern-yellow",
  indigo: "pattern-indigo",
  violet: "pattern-violet",
  sky: "pattern-sky",
};

/**
 * Readable text color over each swatch. Pale yellow is the one light enough to need
 * dark text; the rest carry white.
 */
export const PATTERN_TEXT_CLASS: Record<PatternName, string> = {
  win: "text-white",
  forced: "text-white",
  unforced: "text-white",
  yellow: "text-black",
  indigo: "text-white",
  violet: "text-white",
  sky: "text-white",
};

/** CSS custom properties for the same colors, for chart libraries that need a raw color. */
export const PATTERN_VAR: Record<PatternName, string> = {
  win: "var(--color-outcome-win)",
  forced: "var(--color-outcome-forced)",
  unforced: "var(--color-outcome-unforced)",
  yellow: "var(--color-cat-yellow)",
  indigo: "var(--color-cat-indigo)",
  violet: "var(--color-cat-violet)",
  sky: "var(--color-cat-sky)",
};

/** SVG pattern-fill URLs for the non-outcome categorical colors, defined by
 *  `components/chart-patterns.tsx`'s `<CategoricalPatternDefs />` — the
 *  Recharts-usable equivalent of `PATTERN_CLASS` above, which only paints
 *  HTML boxes. */
export const CATEGORICAL_PATTERN_FILL: Record<CategoryName, string> = {
  yellow: "url(#chart-pattern-yellow)",
  indigo: "url(#chart-pattern-indigo)",
  violet: "url(#chart-pattern-violet)",
  sky: "url(#chart-pattern-sky)",
};

/** A hatch/dot fill reads as texture on a filled bar, but is invisible on a
 *  thin line stroke — a line series' own non-color channel is its dash style
 *  instead, the standard accessible substitute for a stroked mark. */
export const CATEGORICAL_STROKE_DASH: Record<CategoryName, string | undefined> = {
  yellow: undefined,
  indigo: "6 3",
  violet: "2 3",
  sky: "8 3 2 3",
};
