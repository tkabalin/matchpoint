import { BarChart3, ListOrdered } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { CategoricalPatternDefs } from "@/components/chart-patterns";
import { LegibleXTick, LegibleYTick } from "@/components/chart-ticks";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { StatCard } from "@/components/stat-card";
import {
  METRIC_PATTERN,
  buildHistogram,
  buildLeaderboard,
  metricDisplay,
  rankedOnly,
} from "@/lib/analytics/squad-stats";
import type { SquadMetricKey, SquadStatsEntry } from "@/lib/analytics/types.provisional";
import { CATEGORICAL_PATTERN_FILL } from "@/lib/palette";
import { cn } from "@/lib/utils";

const METRIC_LABEL: Record<SquadMetricKey, string> = {
  record: "Record",
  forcedToUnforced: "Forced : Unforced",
  firstServe: "1st serve in %",
};

type NamedEntry = SquadStatsEntry & { name: string };

export function SquadLeaderboardCard({
  entries,
  metric,
  onMetricChange,
  search,
  onSearchChange,
}: {
  entries: NamedEntry[];
  metric: SquadMetricKey;
  onMetricChange: (metric: SquadMetricKey) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) {
  const rows = buildLeaderboard(entries, metric, search);
  const ranked = rankedOnly(entries, search);
  const entryByPlayerId = new Map(entries.map((entry) => [entry.playerId, entry]));

  return (
    <StatCard>
      <div className="flex items-center gap-2">
        <ListOrdered className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="flex-1 text-base font-bold text-foreground">Leaderboard</h3>
        <Select value={metric} onValueChange={(value) => onMetricChange(value as SquadMetricKey)}>
          <SelectTrigger aria-label="Leaderboard metric" size="sm">
            <SelectValue>{(value: string) => METRIC_LABEL[value as SquadMetricKey]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(METRIC_LABEL) as [SquadMetricKey, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Input
        aria-label="Search players"
        placeholder="Search players"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <div className="flex max-h-[230px] flex-col gap-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">No players match.</p>
        ) : (
          rows.map((row) => (
            <Item
              key={row.playerId}
              variant="outline"
              size="sm"
              className={cn(row.rank === null && "opacity-45")}
            >
              <span className="w-4 shrink-0 text-xs font-bold text-muted-foreground">
                {row.rank ?? "—"}
              </span>
              <ItemContent>
                <ItemTitle className="truncate">{row.name}</ItemTitle>
              </ItemContent>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  row.rank === null
                    ? "text-xs font-semibold text-muted-foreground"
                    : "text-sm font-bold text-foreground",
                )}
              >
                {row.rank === null
                  ? `${row.matchesLoggedThisPeriod} ${row.matchesLoggedThisPeriod === 1 ? "match" : "matches"}`
                  : metricDisplay(entryByPlayerId.get(row.playerId)!, metric)}
              </span>
            </Item>
          ))
        )}
      </div>

      <p className="text-[0.625rem] text-muted-foreground">
        Players need 3+ matches logged to appear in the ranking — shown dimmed below with their
        match count until then.
      </p>

      <h3 className="mt-2 flex items-center gap-2 text-base font-bold text-foreground">
        <BarChart3 className="size-6 shrink-0 text-primary" aria-hidden="true" />
        Spread — same metric as above
      </h3>
      <SpreadHistogram entries={ranked} metric={metric} />
    </StatCard>
  );
}

function SpreadHistogram({
  entries,
  metric,
}: {
  entries: SquadStatsEntry[];
  metric: SquadMetricKey;
}) {
  const buckets = buildHistogram(entries, metric);
  const pattern = METRIC_PATTERN[metric];
  const fill = CATEGORICAL_PATTERN_FILL[pattern];
  const config = { count: { label: "Players", color: fill } };

  if (buckets.length === 0) {
    return <p className="text-xs text-muted-foreground">No ranked players yet.</p>;
  }

  return (
    <ChartContainer config={config} className="aspect-[5/3] w-full">
      <BarChart data={buckets}>
        <CategoricalPatternDefs />
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={<LegibleXTick />} />
        <YAxis allowDecimals={false} width={24} tick={<LegibleYTick />} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill={fill} radius={2} />
      </BarChart>
    </ChartContainer>
  );
}
