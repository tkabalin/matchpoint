import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronUp, Rainbow, TrendingUp } from "lucide-react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/**
 * One icon per axis — this chart's only caller is the Rally tab's shot-type
 * radar, so the four labels are pinned here rather than passed in (nothing
 * else to stay generic for yet, per the two-call-site rule). Reuses the same
 * shot-type icons `.claude/rules/web-icons.md` already assigns for the Rally
 * tab's own shot-type breakdown, so a shot type means one icon everywhere on
 * this tab.
 *
 * Shot frequency is shot-type only, not wing×shot-type: capture tracks wing
 * separately (the Style drill's own breakdown), and the radar's real payload
 * never crosses the two, unlike this component's original 8-axis design.
 */
const AXIS_ICON: Record<string, LucideIcon> = {
  Drive: TrendingUp,
  Volley: ChevronUp,
  "Drop shot": ChevronDown,
  Lob: Rainbow,
};

const ICON_SIZE = 32;

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
  // Always centred, never start/end-anchored: an edge-anchored label grows
  // entirely in one direction from its point, and a long one ("Drop shot", the
  // longest axis label this chart draws) reliably overflowed the container the
  // moment it landed on a lower-left/lower-right axis rather than top/bottom.
  // Centring halves the worst-case one-directional reach.
  const textAnchor = "middle";
  const iconDistance = 18;
  const iconX = x + unitX * iconDistance;
  const iconY = y + unitY * iconDistance;
  // Derived from the icon's own footprint rather than a hand-tuned constant per
  // direction: the label starts past the icon's outer edge (half its size) plus
  // a fixed clear gap, so raising ICON_SIZE can't silently reopen the overlap
  // this was fixed for ("the text is covered by the icon" — every axis, not
  // just the ones a previous pass happened to leave enough room for).
  const labelGap = 14;
  const labelOffset = iconDistance + ICON_SIZE / 2 + labelGap;
  const labelX = x + unitX * labelOffset;
  const labelY = y + unitY * labelOffset;

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
        fontSize={11}
        fontWeight={600}
        fill="var(--color-foreground)"
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
  // Scaled to each series' own largest axis, not to a fixed 0-100 range: no
  // domain is set on the radius axis, so Recharts otherwise auto-picks a
  // "nice" ceiling that can sit far above the actual data (e.g. 100, when the
  // largest share here is 20) — the whole shape then renders as a small blip
  // near the centre regardless of how the three remaining axes compare to
  // each other, which is exactly the legibility this chart exists to give.
  // Rescaling so the biggest share reaches SHAPE_FILL_TARGET means the shape
  // always uses the space it's given. Per series, not globally: an H2H overlay
  // (this component's other sanctioned use, `.claude/rules/web-color.md`)
  // needs each player's own shape sized to their own numbers, not squashed by
  // whichever of the two happens to have the bigger single axis.
  const SHAPE_FILL_TARGET = 92;
  const data = first.points.map((point, index) => {
    const row: Record<string, string | number> = { shot: point.shot };
    for (const entry of series) {
      const maxShare = Math.max(...entry.points.map((p) => p.share), 0.0001);
      const share = entry.points[index]?.share ?? 0;
      row[seriesKey(entry.name)] = (share / maxShare) * SHAPE_FILL_TARGET;
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
        margin={{ top: 32, bottom: 38, left: 56, right: 56 }}
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
