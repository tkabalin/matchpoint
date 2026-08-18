import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/**
 * Share of point-ending shots per shot type.
 *
 * One colour per series, never per axis: the shot types are axis labels, so
 * colouring them separately would imply a categorical split that isn't there
 * (`.claude/rules/web-color.md`, per-chart assignment). A single-player view uses
 * the nav colour; an H2H overlay passes two series from the safe non-outcome set.
 */
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
      row[entry.name] = (entry.points[index]?.share ?? 0) * 100;
    }
    return row;
  });

  const config: ChartConfig = Object.fromEntries(
    series.map((entry) => [entry.name, { label: entry.name, color: entry.color }]),
  );

  return (
    <ChartContainer config={config} className={className}>
      <RadarChart data={data} outerRadius="70%">
        <PolarGrid />
        <PolarAngleAxis dataKey="shot" tick={{ fontSize: 10 }} />
        {series.map((entry) => (
          <Radar
            key={entry.name}
            dataKey={entry.name}
            stroke={entry.color}
            fill={entry.color}
            fillOpacity={0.25}
          />
        ))}
      </RadarChart>
    </ChartContainer>
  );
}
