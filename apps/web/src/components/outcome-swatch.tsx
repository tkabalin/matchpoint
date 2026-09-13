import type { LucideIcon } from "lucide-react";

import { PATTERN_CLASS, PATTERN_TEXT_CLASS, type PatternName } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * The patterned swatches the palette rule requires: color plus its pattern plus the
 * dual-ring halo, never one without the others. Three shapes of the same idea —
 * a labelled square, a legend dot, and a proportional stack.
 */

const SWATCH_SIZE = {
  sm: "size-4 text-[0.5rem]",
  md: "size-5 text-[0.5625rem]",
  lg: "size-6 text-[0.625rem]",
} as const;

export function OutcomeSwatch({
  pattern,
  label,
  size = "md",
  className,
}: {
  pattern: PatternName;
  /** Single character, "W" or "L" in every current use. */
  label: string;
  size?: keyof typeof SWATCH_SIZE;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "swatch-halo inline-flex shrink-0 items-center justify-center rounded-sm font-bold",
        SWATCH_SIZE[size],
        PATTERN_CLASS[pattern],
        PATTERN_TEXT_CLASS[pattern],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function OutcomeLegend({
  items,
  className,
}: {
  items: { pattern: PatternName; label: string; icon?: LucideIcon }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-3 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "swatch-halo size-2.5 shrink-0 rounded-[2px]",
              PATTERN_CLASS[item.pattern],
            )}
          />
          {item.icon && <item.icon className="size-3.5 shrink-0" aria-hidden="true" />}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Parts of a whole in one bar (win/loss record, point-outcome mix). Segments are
 * given as weights and normalised here, so callers pass raw counts.
 */
export function OutcomeStack({
  segments,
  className,
}: {
  segments: { pattern: PatternName; weight: number; label: string }[];
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
  if (total === 0) return null;

  return (
    <div className={cn("flex h-2.5 overflow-hidden rounded-sm border", className)}>
      {segments.map((segment) => (
        <span
          key={segment.label}
          title={segment.label}
          className={PATTERN_CLASS[segment.pattern]}
          style={{ width: `${(segment.weight / total) * 100}%` }}
        />
      ))}
    </div>
  );
}
