import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Rainbow,
  TrendingDown,
  TrendingUp,
  Waves,
} from "lucide-react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/**
 * One icon per axis, all eight distinct — this chart's only caller is the Rally
 * tab's wing×shot-type radar, so the eight labels are pinned here rather than
 * passed in (nothing else to stay generic for yet, per the two-call-site rule).
 * Forehand and backhand versions of the same shot deliberately don't share an
 * icon: reusing one across two different axes reads as "these are the same
 * thing," which they aren't.
 */
const AXIS_ICON: Record<string, LucideIcon> = {
  "FH Drive": TrendingUp,
  "BH Drive": TrendingDown,
  "FH Volley": ChevronUp,
  "BH Volley": ChevronsUp,
  "FH Drop": ChevronDown,
  "BH Drop": ChevronsDown,
  "FH Lob": Rainbow,
  "BH Lob": Waves,
};

const ICON_SIZE = 18;

interface AxisTickProps {
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  payload?: { value: string };
}

/**
 * Replaces `PolarAngleAxis`'s default plain-text tick with an icon-plus-label
 * pair, pushed outward from the chart's centre along the same radial line as
 * its axis — so the icon reads as belonging to that spoke of the web, not
 * floating in a fixed screen direction.
 */
function AxisTick({ x = 0, y = 0, cx = 0, cy = 0, payload }: AxisTickProps) {
  const label = payload?.value ?? "";
  const Icon = AXIS_ICON[label];
  const dx = x - cx;
  const dy = y - cy;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;
  const textAnchor = dx > 6 ? "start" : dx < -6 ? "end" : "middle";
  const iconX = x + unitX * 14;
  const iconY = y + unitY * 14;
  const labelX = x + unitX * 30;
  const labelY = y + unitY * 30;

  return (
    <g>
      {Icon && (
        <Icon
          x={iconX - ICON_SIZE / 2}
          y={iconY - ICON_SIZE / 2}
          width={ICON_SIZE}
          height={ICON_SIZE}
          className="text-foreground"
        />
      )}
      <text
        x={labelX}
        y={labelY}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fontSize={9}
        fill="var(--color-muted-foreground)"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Share of point-ending shots per shot type.
 *
 * One colour per series, never per axis: the shot types are axis labels, so
 * colouring them separately would imply a categorical split that isn't there
 * (`.claude/rules/web-color.md`, per-chart assignment). A single-player view uses
 * the nav colour; an H2H overlay passes two series from the safe non-outcome set.
 */
/**
 * A series' key becomes a CSS custom property name — `ChartContainer` emits
 * `--color-<key>` into a <style> block — so it has to be an identifier. A series named
 * "Share of point-enders" produced `--color-Share of point-enders`, which invalidates
 * the whole stylesheet rather than just that declaration. The label keeps the name.
 */
function seriesKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function ShotRadar({
  series,
  className,
}: {
  series: { name: string; color: string; points: { shot: string; share: number }[] }[];
  className?: string;
}) {
  const [first] = series;
  if (!first) return null;

  // Recharts wants one row per axis with a key per series.
  const data = first.points.map((point, index) => {
    const row: Record<string, string | number> = { shot: point.shot };
    for (const entry of series) {
      row[seriesKey(entry.name)] = (entry.points[index]?.share ?? 0) * 100;
    }
    return row;
  });

  const config: ChartConfig = Object.fromEntries(
    series.map((entry) => [seriesKey(entry.name), { label: entry.name, color: entry.color }]),
  );

  return (
    <ChartContainer config={config} className={className}>
      <RadarChart
        data={data}
        outerRadius="52%"
        margin={{ top: 20, bottom: 20, left: 36, right: 36 }}
      >
        <PolarGrid />
        <PolarAngleAxis dataKey="shot" tick={<AxisTick />} />
        {series.map((entry) => (
          <Radar
            key={entry.name}
            dataKey={seriesKey(entry.name)}
            stroke={entry.color}
            fill={entry.color}
            fillOpacity={0.25}
          />
        ))}
      </RadarChart>
    </ChartContainer>
  );
}
