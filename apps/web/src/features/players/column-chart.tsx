import type { LucideIcon } from "lucide-react";

import { PATTERN_CLASS, type PatternName } from "@/lib/palette";
import { cn } from "@/lib/utils";

// The bar zone's own fixed height in pixels. Every bar is computed as a share of
// this in pixels directly, rather than a CSS percentage height — a percentage
// height only resolves against an ancestor with a *definite* height, and this
// chart's column is sized by its own content (icon, value, caption) with
// `items-end` on the row so columns don't stretch to fill it; a percentage bar
// inside that column has nothing definite to be a percentage of, and silently
// collapses to zero. Pixels sidestep that entirely.
const BAR_ZONE_HEIGHT = 64;
// A visible sliver rather than nothing: a real zero and "no bar drew" must not
// look the same, or a coach reads a zero as missing data.
const MIN_FILL_HEIGHT = 4;

export interface ColumnChartColumn {
  /** Height is this value's share of `ceiling` — every column in one chart
   *  shares a ceiling, so heights compare directly. */
  value: number | null;
  /** Below the bar. */
  caption: string;
  Icon?: LucideIcon;
  pattern: PatternName;
}

/**
 * A small bar chart drawn as vertical columns rather than the app's usual
 * horizontal rows (`BreakdownBars`) — for a stat whose columns read as heights
 * compared side by side (rally length won vs lost, a shot-type breakdown),
 * where a horizontal row would make that comparison a ruler measurement
 * instead of a glance. Two call sites (`player-card.tsx`'s rally-length and
 * shot-frequency charts), so this stays local to the slice rather than a
 * shared component per `.claude/rules/web.md`'s two-call-site rule.
 */
export function ColumnChart({
  title,
  columns,
  ceiling,
  unit = "",
  className,
}: {
  title?: string;
  columns: ColumnChartColumn[];
  /** Shared across every column — the chart's whole point is that heights are
   *  directly comparable, so no column may scale to its own maximum. */
  ceiling: number;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {title && <p className="text-xs font-semibold text-muted-foreground">{title}</p>}
      <div className="flex items-end gap-2">
        {columns.map((column, index) => {
          const heightPx =
            column.value === null
              ? 0
              : ceiling === 0
                ? 0
                : Math.max((column.value / ceiling) * BAR_ZONE_HEIGHT, MIN_FILL_HEIGHT);
          return (
            <div key={index} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="flex w-full items-end justify-center"
                style={{ height: BAR_ZONE_HEIGHT }}
              >
                {column.value === null ? (
                  <div
                    className="h-2 w-full rounded-sm border border-dashed border-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <div
                    className={cn("w-full rounded-t-sm", PATTERN_CLASS[column.pattern])}
                    style={{ height: heightPx }}
                  />
                )}
              </div>
              <span className="text-xs font-bold tabular-nums">
                {column.value === null ? "—" : `${column.value}${unit}`}
              </span>
              <span className="flex items-center gap-1 text-center text-[0.625rem] text-muted-foreground">
                {column.Icon && <column.Icon className="size-3 shrink-0" aria-hidden="true" />}
                {column.caption}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
