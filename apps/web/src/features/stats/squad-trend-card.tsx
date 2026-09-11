import type { SquadMetric, Surface } from "@matchpoint/api-client";
import { getSquadTrendOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { LegibleXTick, LegibleYTick } from "@/components/chart-ticks";
import { StatCard } from "@/components/stat-card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { METRIC_PATTERN } from "@/lib/analytics/squad-stats";
import type { SquadMetricKey } from "@/lib/analytics/types.provisional";
import { CATEGORICAL_STROKE_DASH, PATTERN_VAR } from "@/lib/palette";

const TREND_METRIC_LABEL: Record<SquadMetricKey, string> = {
  record: "Record (win %)",
  forcedToUnforced: "Forced : Unforced",
  firstServe: "1st serve in %",
};

// The dropdown's own vocabulary (shared with the leaderboard and histogram)
// isn't the wire's — the API's `SquadMetric` enum spells the last two
// differently.
const API_METRIC: Record<SquadMetricKey, SquadMetric> = {
  record: "record",
  forcedToUnforced: "forced_to_unforced",
  firstServe: "first_serve_in",
};

/** Its own, independent metric selector — deliberately separate state from
 *  the leaderboard's dropdown above, so a coach can watch the squad's serve
 *  trend while the leaderboard is sorted by something else entirely. */
export function SquadTrendCard({
  metric,
  onMetricChange,
  surface,
}: {
  metric: SquadMetricKey;
  onMetricChange: (metric: SquadMetricKey) => void;
  /** Narrows the pooled weekly tallies to one surface via the real `surface`
   *  axis (#225) — undefined means every surface, matching the shared filter
   *  row above this card on the squad stats page. */
  surface?: Surface;
}) {
  const { data: trend } = useQuery(
    getSquadTrendOptions({ query: { metric: API_METRIC[metric], surface } }),
  );
  // Every point can legitimately be null at once — a roster with no resulted
  // matches in the window — which would otherwise draw a blank chart (axes,
  // no line, no dots) that reads as broken rather than as "not enough data".
  const hasData = trend?.some((point) => point.value !== null) ?? false;
  const pattern = METRIC_PATTERN[metric];
  const color = PATTERN_VAR[pattern];
  const dash = CATEGORICAL_STROKE_DASH[pattern];
  const config = { value: { label: TREND_METRIC_LABEL[metric], color } };

  return (
    <StatCard>
      <div className="flex items-center gap-2">
        <TrendingUp className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="flex-1 text-base font-bold text-foreground">Squad trend</h3>
        <Select value={metric} onValueChange={(value) => onMetricChange(value as SquadMetricKey)}>
          <SelectTrigger aria-label="Trend metric" size="sm">
            <SelectValue>
              {(value: string) => TREND_METRIC_LABEL[value as SquadMetricKey]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(TREND_METRIC_LABEL) as [SquadMetricKey, string][]).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {trend && !hasData ? (
        <p className="flex aspect-[5/2] w-full items-center justify-center text-center text-xs text-muted-foreground">
          Not enough recent matches to show a trend yet.
        </p>
      ) : trend ? (
        <ChartContainer config={config} className="aspect-[5/2] w-full">
          <LineChart data={trend}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} tick={<LegibleXTick />} />
            <YAxis width={28} tick={<LegibleYTick />} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {/* A hatch fill would be invisible on a 2px stroke, so the line's
                own non-color channel is its dash style — solid/dashed/dotted
                per metric, the standard accessible substitute for a stroked
                mark (see chart-patterns.tsx's own doc comment). The background-
                colored pass underneath is the halo web-color.md's dual-ring rule
                asks for on a chart mark (indigo/violet lose effective contrast
                as a thin stroke even when the raw color passes WCAG on its
                own) — legendType/tooltipType "none" keeps it out of both. */}
            <Line
              dataKey="value"
              stroke="var(--background)"
              strokeWidth={4}
              dot={false}
              legendType="none"
              tooltipType="none"
            />
            <Line
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              strokeDasharray={dash}
              dot={{ r: 3, fill: color, stroke: "var(--background)", strokeWidth: 2 }}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <Skeleton className="aspect-[5/2] w-full" />
      )}

      <p className="text-[0.625rem] text-muted-foreground">
        last 6 weeks · pooled across the squad
      </p>
    </StatCard>
  );
}
