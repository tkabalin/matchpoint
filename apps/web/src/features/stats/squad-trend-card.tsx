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
import { getSquadTrendOptions } from "@/lib/analytics/analytics-options";
import { METRIC_PATTERN } from "@/lib/analytics/squad-stats";
import type { SquadMetricKey } from "@/lib/analytics/types.provisional";
import { CATEGORICAL_STROKE_DASH, PATTERN_VAR } from "@/lib/palette";

const TREND_METRIC_LABEL: Record<SquadMetricKey, string> = {
  record: "Record (win %)",
  forcedToUnforced: "Forced : Unforced",
  firstServe: "1st serve %",
};

/** Its own, independent metric selector — deliberately separate state from
 *  the leaderboard's dropdown above, so a coach can watch the squad's serve
 *  trend while the leaderboard is sorted by something else entirely. */
export function SquadTrendCard({
  metric,
  onMetricChange,
}: {
  metric: SquadMetricKey;
  onMetricChange: (metric: SquadMetricKey) => void;
}) {
  const { data: trend } = useQuery(getSquadTrendOptions({ query: { metric } }));
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

      {trend ? (
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

      <p className="text-[0.625rem] text-muted-foreground">last 6 weeks · squad average</p>
    </StatCard>
  );
}
