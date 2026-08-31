import type { BreakdownRow } from "@matchpoint/api-client";
import type { LucideIcon } from "lucide-react";

import { OutcomeLegend } from "@/components/outcome-swatch";
import { PATTERN_CLASS, type PatternName } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * A labelled quantity per row, drawn against a ceiling shared across the group —
 * points won by final shot, how losses arrive, and so on.
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
  icon,
  unit = "",
  className,
}: {
  rows: BreakdownRow[];
  /** One colour for the group, or a function when rows don't all mean the same
   *  thing (a double-fault row sitting among winner rows). */
  pattern?: PatternName | ((row: BreakdownRow) => PatternName);
  /** Colour for the second stacked segment, where rows carry one. */
  secondaryPattern?: PatternName;
  legend?: { pattern: PatternName; label: string }[];
  /** A large, distinct Lucide icon per row, keyed by label — every stat row gets
   *  its own symbol rather than relying on colour alone to tell rows apart. */
  icon?: (row: BreakdownRow) => LucideIcon;
  /** Suffix appended to each row's value, e.g. "%" when rows are percentages
   *  rather than raw counts — a bare number reads as a count by default. */
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {rows.map((row) => {
        // A group where nothing has been recorded yet has max: 0, and 0 / 0 is NaN
        // — a "NaN%" width is dropped by the browser, so the bar would render
        // with no fill at all rather than as a legitimately empty one.
        const primary = row.max === 0 ? 0 : (row.value / row.max) * 100;
        const secondary = row.max === 0 ? 0 : ((row.secondary_value ?? 0) / row.max) * 100;
        const rowPattern = typeof pattern === "function" ? pattern(row) : pattern;
        const Icon = icon?.(row);

        return (
          <div key={row.label} className="flex items-center gap-2.5">
            {Icon && <Icon className="size-6 shrink-0 text-foreground" aria-hidden="true" />}
            <div className="flex-1">
              <div className="flex justify-between text-xs">
                <span>{row.label}</span>
                <span className="tabular-nums">
                  {row.secondary_value === undefined || row.secondary_value === null
                    ? `${row.value}${unit}`
                    : `${row.value}${unit} UFE · ${row.secondary_value}${unit} FE`}
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
          </div>
        );
      })}
      {legend && <OutcomeLegend items={legend} className="mt-1" />}
    </div>
  );
}
