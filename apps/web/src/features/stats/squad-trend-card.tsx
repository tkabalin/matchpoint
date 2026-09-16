import type { SquadMetric, Surface } from "@matchpoint/api-client";
import { getSquadTrendOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChipRow } from "@/components/chip-row";
import { LegibleXTick, LegibleYTick } from "@/components/chart-ticks";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  METRIC_ICON,
  METRIC_LABEL,
  METRIC_PATTERN,
  fillSquadTrendGaps,
} from "@/lib/analytics/squad-stats";
import type { SquadTrendMetricKey } from "@/lib/analytics/types.provisional";
import { getErrorStatus } from "@/lib/error-status";
import { CATEGORICAL_STROKE_DASH, PATTERN_VAR } from "@/lib/palette";

// Only the trend's own three metrics — not every `METRIC_LABEL` entry, which
// (since #267) also carries the leaderboard-only ones the squad trend wire
// endpoint has no way to plot.
const TREND_METRICS: SquadTrendMetricKey[] = ["record", "forcedToUnforced", "firstServe"];
const METRIC_OPTIONS: { value: SquadTrendMetricKey; label: string; icon: LucideIcon }[] =
  TREND_METRICS.map((value) => ({ value, label: METRIC_LABEL[value], icon: METRIC_ICON[value] }));

// The chip row's own vocabulary (shared with the leaderboard) isn't the
// wire's — the API's `SquadMetric` enum spells the last two differently.
const API_METRIC: Record<SquadTrendMetricKey, SquadMetric> = {
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
  metric: SquadTrendMetricKey;
  onMetricChange: (metric: SquadTrendMetricKey) => void;
  /** Narrows the pooled weekly tallies to one surface via the real `surface`
   *  axis (#225) — undefined means every surface, matching the shared filter
   *  row above this card on the squad stats page. */
  surface?: Surface;
}) {
  const {
    data: trend,
    isError,
    error,
  } = useQuery(getSquadTrendOptions({ query: { metric: API_METRIC[metric], surface } }));
  // Every point can legitimately be null at once — a roster with no resulted
  // matches in the window — which would otherwise draw a blank chart (axes,
  // no line, no dots) that reads as broken rather than as "not enough data".
  // Computed off the raw `trend`, before the gap fill below, so an all-null
  // week set still hits the empty state rather than the fill quietly turning
  // "nothing at all" into "something" (fillSquadTrendGaps is a no-op here by
  // construction, but this keeps the two checks independent regardless).
  const hasData = trend?.some((point) => point.value !== null) ?? false;
  // A week nobody logged a match in isn't missing information — it's
  // confirmation nothing changed, so it carries the last real value forward
  // rather than breaking the line. `carriedIndices` is what lets a carried
  // point draw as a hollow dot instead of a normal filled one, so a flat
  // stretch never reads as "the squad held steady" when nobody played.
  const { trend: filledTrend, carriedIndices } = trend
    ? fillSquadTrendGaps(trend)
    : { trend: undefined, carriedIndices: new Set<number>() };
  const pattern = METRIC_PATTERN[metric];
  const color = PATTERN_VAR[pattern];
  const dash = CATEGORICAL_STROKE_DASH[pattern];
  const config = { value: { label: METRIC_LABEL[metric], color } };

  return (
    <StatCard>
      <div className="flex items-center gap-2">
        <TrendingUp className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold text-foreground">Squad trend</h3>
      </div>

      <ChipRow<SquadTrendMetricKey>
        aria-label="Trend metric"
        options={METRIC_OPTIONS}
        value={metric}
        onChange={onMetricChange}
        scroll
      />

      {isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorStatus(error) === 401 ? (
              <>
                Your session has expired. <Link to="/">Sign in</Link> to see the squad trend.
              </>
            ) : (
              "Could not load the squad trend."
            )}
          </AlertDescription>
        </Alert>
      ) : trend && !hasData ? (
        <p className="flex aspect-[5/2] w-full items-center justify-center text-center text-xs text-muted-foreground">
          Not enough recent matches to show a trend yet.
        </p>
      ) : trend ? (
        <ChartContainer config={config} className="aspect-[5/2] w-full">
          <LineChart data={filledTrend}>
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
              // A carried-forward point (no match logged that week) draws
              // hollow — background fill, colored ring — instead of the
              // normal solid dot, so it never looks like a real result.
              dot={(dotProps: { cx?: number; cy?: number; index?: number }) => {
                const isCarried = carriedIndices.has(dotProps.index ?? -1);
                return (
                  <circle
                    key={dotProps.index}
                    cx={dotProps.cx}
                    cy={dotProps.cy}
                    r={3}
                    fill={isCarried ? "var(--background)" : color}
                    stroke={isCarried ? color : "var(--background)"}
                    strokeWidth={2}
                  />
                );
              }}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <Skeleton className="aspect-[5/2] w-full" />
      )}

      <p className="text-[0.625rem] text-muted-foreground">
        6 weeks to the last match · pooled across the squad
      </p>
    </StatCard>
  );
}
