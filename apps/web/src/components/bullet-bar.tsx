import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { ProgressIndicator, ProgressRoot, ProgressTrack } from "@/components/ui/progress";
import { PATTERN_CLASS, PATTERN_TEXT_CLASS, type PatternName } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * A single metric shown as a bullet bar: value, trend, and a track carrying both
 * the current fill and the baseline it's being judged against.
 *
 * The baseline marker is the reason this isn't a bare `Progress` — a percentage on
 * its own doesn't say whether it's good, and the coach's question is always "versus
 * what?". Every frame in the wireframe that shows a stat shows it in this shape.
 */

export interface BulletDelta {
  /** Magnitude only — the arrow carries the sign. */
  value: string;
  direction: "up" | "down";
  tone: PatternName;
}

export interface BulletBarProps {
  label: string;
  /** Formatted for display ("72%", "1.4", "7–3") — this component never formats. */
  value: string;
  /** Fill as a fraction of the track, 0–1. */
  fill: number;
  /**
   * Usually a score band (`win`/`unforced`), but takes any palette name so H2H can
   * colour an opponent's stats as a category rather than as the coach's own outcome.
   */
  tone: PatternName;
  /** Sample size behind the number, rendered as-is ("n=14", "n=20 sets"). */
  sampleSize?: string;
  /** Comparison point on the same 0–1 scale as `fill`. */
  baseline?: number;
  delta?: BulletDelta;
  /** End labels under the track. Omitted entirely when the scale is a plain 0–100%. */
  scale?: [string, string];
  coachNote?: ReactNode;
  /** Larger type and a thicker track, for the one hero metric at the top of a tab. */
  hero?: boolean;
  className?: string;
}

function clamp(fraction: number): number {
  return Math.max(0, Math.min(1, fraction));
}

export function BulletBar({
  label,
  value,
  fill,
  tone,
  sampleSize,
  baseline,
  delta,
  scale,
  coachNote,
  hero = false,
  className,
}: BulletBarProps) {
  const DeltaIcon = delta?.direction === "down" ? ArrowDown : ArrowUp;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {sampleSize && (
          <span className="shrink-0 text-[0.625rem] text-muted-foreground tabular-nums">
            {sampleSize}
          </span>
        )}
      </div>

      <div className="mt-0.5 mb-1.5 flex items-baseline justify-between gap-2">
        <span className={cn("font-bold tabular-nums", hero ? "text-3xl" : "text-xl")}>{value}</span>
        {delta && (
          <Badge
            variant="outline"
            aria-label={`${delta.direction === "up" ? "Up" : "Down"} ${delta.value}`}
            className={cn(
              "swatch-halo border-transparent tabular-nums",
              PATTERN_CLASS[delta.tone],
              PATTERN_TEXT_CLASS[delta.tone],
            )}
          >
            <DeltaIcon aria-hidden="true" />
            {delta.value}
          </Badge>
        )}
      </div>

      <ProgressRoot value={clamp(fill) * 100}>
        <ProgressTrack
          className={cn("overflow-visible rounded-sm border bg-muted", hero ? "h-3.5" : "h-2.5")}
        >
          <ProgressIndicator className={cn("rounded-l-sm", PATTERN_CLASS[tone])} />
          {baseline !== undefined && (
            // Sits proud of the track top and bottom so it stays readable where it
            // crosses the patterned fill rather than disappearing into it.
            <span
              aria-hidden="true"
              className="absolute -top-1 -bottom-1 w-[1.5px] bg-foreground/60"
              style={{ left: `${clamp(baseline) * 100}%` }}
            />
          )}
        </ProgressTrack>
      </ProgressRoot>

      {scale && (
        <div className="mt-1 flex justify-between text-[0.625rem] text-muted-foreground">
          <span>{scale[0]}</span>
          <span>{scale[1]}</span>
        </div>
      )}

      {coachNote && <p className="mt-2 text-xs text-muted-foreground italic">{coachNote}</p>}
    </div>
  );
}
