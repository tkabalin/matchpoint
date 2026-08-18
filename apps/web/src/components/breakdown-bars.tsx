import { OutcomeLegend } from "@/components/outcome-swatch";
import { PATTERN_CLASS, type PatternName } from "@/lib/palette";
import type { BreakdownRow } from "@/lib/analytics/types.provisional";
import { cn } from "@/lib/utils";

/**
 * A labelled quantity per row, drawn against a ceiling shared across the group —
 * winners by shot type, how losses arrive, and so on.
 *
 * A shared ceiling rather than per-row normalisation is the whole point: rows are
 * there to be compared with each other, and scaling each to its own width would
 * make every row look the same size.
 */
export function BreakdownBars({
  rows,
  pattern = "win",
  secondaryPattern,
  legend,
  className,
}: {
  rows: BreakdownRow[];
  /** One colour for the group, or a function when rows don't all mean the same
   *  thing (a double-fault row sitting among winner rows). */
  pattern?: PatternName | ((row: BreakdownRow) => PatternName);
  /** Colour for the second stacked segment, where rows carry one. */
  secondaryPattern?: PatternName;
  legend?: { pattern: PatternName; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {rows.map((row) => {
        const primary = (row.value / row.max) * 100;
        const secondary = ((row.secondaryValue ?? 0) / row.max) * 100;
        const rowPattern = typeof pattern === "function" ? pattern(row) : pattern;

        return (
          <div key={row.label}>
            <div className="flex justify-between text-xs">
              <span>{row.label}</span>
              <span className="tabular-nums">
                {row.secondaryValue === undefined
                  ? row.value
                  : `${row.value} UFE · ${row.secondaryValue} FE`}
              </span>
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-sm bg-muted">
              <span className={PATTERN_CLASS[rowPattern]} style={{ width: `${primary}%` }} />
              {secondary > 0 && secondaryPattern && (
                <span
                  className={PATTERN_CLASS[secondaryPattern]}
                  style={{ width: `${secondary}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
      {legend && <OutcomeLegend items={legend} className="mt-1" />}
    </div>
  );
}
