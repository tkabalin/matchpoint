import type { BulletBarProps } from "@/components/bullet-bar";
import type { PatternName } from "@/lib/palette";

import type { Metric } from "./types.provisional";

/**
 * Turns a `Metric` DTO into what `BulletBar` renders.
 *
 * All display formatting lives here rather than in the fixtures, so the fixtures
 * stay shaped like an API response and the real endpoint can drop straight in.
 */

/** Trims float noise ("1.4000000000000001") without forcing decimals onto integers. */
function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function formatValue(metric: Metric): string {
  if (metric.display !== undefined) return metric.display;
  return metric.unit === "percent" ? `${trim(metric.value)}%` : trim(metric.value);
}

/**
 * Whether the number moved the way the coach wants. Falls back to the metric's own
 * direction when there's nothing to compare against, so an error rate still reads as
 * bad on a screen that shows it without a baseline.
 */
function isGood(metric: Metric): boolean {
  const movement =
    metric.delta ?? (metric.baseline === null ? null : metric.value - metric.baseline);
  if (movement === null || movement === 0) return metric.higherIsBetter;
  return movement > 0 === metric.higherIsBetter;
}

export function metricToBullet(
  metric: Metric,
  options: { hero?: boolean; coachNote?: string; tone?: PatternName } = {},
): BulletBarProps {
  const tone: PatternName = options.tone ?? (isGood(metric) ? "win" : "unforced");

  return {
    label: metric.label,
    value: formatValue(metric),
    fill: metric.value / metric.max,
    tone,
    sampleSize: metric.sampleSize,
    baseline: metric.baseline === null ? undefined : metric.baseline / metric.max,
    delta:
      metric.delta === null || metric.delta === 0
        ? undefined
        : {
            value: trim(Math.abs(metric.delta)),
            direction: metric.delta > 0 ? "up" : "down",
            tone,
          },
    // A 0–100 percentage scale is the assumed default and stays unlabelled; anything
    // else has to say what its ceiling is or the fill can't be read.
    scale: metric.unit === "percent" ? undefined : ["0", trim(metric.max)],
    coachNote: options.coachNote,
    hero: options.hero,
  };
}
