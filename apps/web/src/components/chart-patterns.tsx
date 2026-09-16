/**
 * SVG `<pattern>` fills for the categorical palette's non-outcome colors —
 * the Recharts-usable equivalent of `app.css`'s `pattern-*` utility classes,
 * which are `background-image` based and only paint HTML boxes, never an
 * SVG `fill`. Same tile geometry as `.claude/rules/web-color.md` specifies
 * for each color, so a chart bar and a badge sharing a color read as the
 * same category by texture too, not just hue.
 *
 * Render `<CategoricalPatternDefs />` once per chart (inside the Recharts
 * container, alongside its data) and reference a color via
 * `CATEGORICAL_PATTERN_FILL[name]` (`lib/palette.ts`) wherever that chart
 * takes a `fill`.
 *
 * Untested against real hover/tooltip interaction: `rally-hypnogram.tsx`
 * tried the exact same shape (a `<defs>` wrapped in its own named component,
 * `LossPatternDefs`, rather than a literal `<defs>` inline in the chart's
 * JSX) and it broke Recharts' tooltip on hover specifically, even though the
 * bars themselves rendered correctly — Recharts' own docs only ever show a
 * literal inline `<defs>`, never one behind a wrapper component, and that
 * turned out to matter. If this component is ever wired up for real, inline
 * its `<defs>` at the call site instead of rendering `<CategoricalPatternDefs />`
 * as a child, and confirm hovering a bar that uses one of these fills still
 * works before shipping it.
 */
export function CategoricalPatternDefs() {
  return (
    <defs>
      <pattern id="chart-pattern-yellow" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="var(--color-cat-yellow)" />
        <path d="M0 0 L12 12 M12 0 L0 12" stroke="black" strokeOpacity="0.45" strokeWidth="2.5" />
      </pattern>
      <pattern id="chart-pattern-indigo" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="var(--color-cat-indigo)" />
        <circle cx="4" cy="4" r="1.5" fill="white" fillOpacity="0.5" />
      </pattern>
      <pattern id="chart-pattern-violet" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="var(--color-cat-violet)" />
        <path d="M0 0 L6 6 M6 0 L0 6" stroke="black" strokeOpacity="0.4" strokeWidth="1.5" />
      </pattern>
      <pattern id="chart-pattern-sky" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="var(--color-cat-sky)" />
        <rect width="8" height="24" fill="white" fillOpacity="0.6" />
      </pattern>
    </defs>
  );
}
