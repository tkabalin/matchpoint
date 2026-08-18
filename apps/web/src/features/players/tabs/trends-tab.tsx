import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";

import { BreakdownBars } from "@/components/breakdown-bars";
import { BulletBar } from "@/components/bullet-bar";
import { SegmentedControl } from "@/components/segmented-control";
import { StatCard } from "@/components/stat-card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { getTrendStatsOptions } from "@/lib/analytics/analytics-options";
import { metricToBullet } from "@/lib/analytics/format";
import type { TrendWindow } from "@/lib/analytics/types.provisional";

type View = "trend" | "spread";

/** Below this many matches a spread or a fitted line reads as signal it isn't. */
const MIN_MATCHES_FOR_SPREAD = 5;
const MIN_MATCHES_FOR_FIT = 8;

/** Ordinary least-squares fit, returned as the two endpoints of the drawn line. */
function leastSquaresSegment(
  points: { unforcedErrors: number; gamesLost: number }[],
): [{ x: number; y: number }, { x: number; y: number }] {
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.unforcedErrors, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.gamesLost, 0) / n;
  const variance = points.reduce((sum, p) => sum + (p.unforcedErrors - meanX) ** 2, 0);
  const covariance = points.reduce(
    (sum, p) => sum + (p.unforcedErrors - meanX) * (p.gamesLost - meanY),
    0,
  );
  // Every match having the same error count leaves nothing to fit; a flat line
  // through the mean is the honest answer rather than a divide by zero.
  const slope = variance === 0 ? 0 : covariance / variance;
  const xs = points.map((p) => p.unforcedErrors);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    { x: minX, y: meanY + slope * (minX - meanX) },
    { x: maxX, y: meanY + slope * (maxX - meanX) },
  ];
}

export function TrendsTab({ playerId }: { playerId: string }) {
  const [window, setWindow] = useState<TrendWindow>("last10");
  const [view, setView] = useState<View>("trend");
  const { data, isPending } = useQuery(
    getTrendStatsOptions({ path: { player_id: playerId }, query: { window } }),
  );

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  const distributionTotal = data.distribution.reduce((sum, bucket) => sum + bucket.matches, 0);

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        aria-label="Trend window"
        value={window}
        onValueChange={setWindow}
        options={[
          { value: "last5", label: "Last 5" },
          { value: "last10", label: "Last 10" },
          { value: "season", label: "Season" },
        ]}
      />

      <StatCard>
        <p className="rounded-sm border-l-2 border-primary bg-primary/5 px-2 py-1.5 text-xs font-semibold text-primary">
          {data.insight}
        </p>
      </StatCard>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
          Metric lines
        </span>
        <SegmentedControl
          aria-label="Metric view"
          value={view}
          onValueChange={setView}
          className="w-32"
          options={[
            { value: "trend", label: "Trend" },
            { value: "spread", label: "Spread" },
          ]}
        />
      </div>

      {view === "trend" ? (
        data.metrics.map((metric) => (
          <StatCard key={metric.label}>
            <BulletBar {...metricToBullet(metric)} />
          </StatCard>
        ))
      ) : (
        <StatCard
          title={`Spread — ${data.distributionLabel}`}
          note={`Same average as any trend line, but consistency only shows up here · n=${distributionTotal} matches`}
        >
          {distributionTotal < MIN_MATCHES_FOR_SPREAD ? (
            <p className="text-xs text-muted-foreground">
              {`Needs at least ${MIN_MATCHES_FOR_SPREAD} matches to render a spread.`}
            </p>
          ) : (
            <ChartContainer
              config={{ matches: { label: "Matches", color: "var(--color-primary)" } }}
              className="aspect-[5/3] w-full"
            >
              <BarChart data={data.distribution}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
                <YAxis allowDecimals={false} width={20} tick={{ fontSize: 9 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {/* Single-series distribution: nav blue, no categorical colour. */}
                <Bar dataKey="matches" fill="var(--color-primary)" radius={2} />
              </BarChart>
            </ChartContainer>
          )}
        </StatCard>
      )}

      <StatCard
        title="Journal correlation — tag vs metric"
        note={`Tag: “${data.journalCorrelation.tag}”`}
      >
        {/* Two colours from the safe non-outcome set: tagged vs untagged is a
            category split, not a good/bad outcome. */}
        <BreakdownBars
          rows={[
            {
              label: `Tagged (n=${data.journalCorrelation.tagged.sampleSize})`,
              value: data.journalCorrelation.tagged.value,
              max: 100,
            },
            {
              label: `Untagged (n=${data.journalCorrelation.untagged.sampleSize})`,
              value: data.journalCorrelation.untagged.value,
              max: 100,
            },
          ]}
          pattern={(row) => (row.label.startsWith("Tagged") ? "yellow" : "violet")}
          legend={[
            { pattern: "yellow", label: `Tagged — ${data.journalCorrelation.metricLabel}` },
            { pattern: "violet", label: `Untagged — ${data.journalCorrelation.metricLabel}` },
          ]}
        />
      </StatCard>

      <StatCard
        title="Correlation — unforced errors vs games lost"
        note={`Per match · n=${data.correlation.length}`}
        footnote={
          data.correlation.length >= MIN_MATCHES_FOR_FIT
            ? "More unforced errors track with more games lost."
            : undefined
        }
      >
        {data.correlation.length < MIN_MATCHES_FOR_FIT ? (
          <p className="text-xs text-muted-foreground">
            {`Needs at least ${MIN_MATCHES_FOR_FIT} matches before a line through these points means anything.`}
          </p>
        ) : (
          <ChartContainer
            config={{ gamesLost: { label: "Games lost", color: "var(--color-primary)" } }}
            className="aspect-[5/3] w-full"
          >
            <ScatterChart data={data.correlation}>
              <CartesianGrid />
              <XAxis
                type="number"
                dataKey="unforcedErrors"
                name="Unforced errors"
                tick={{ fontSize: 9 }}
              />
              <YAxis
                type="number"
                dataKey="gamesLost"
                name="Games lost"
                width={20}
                tick={{ fontSize: 9 }}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Scatter dataKey="gamesLost" fill="var(--color-primary)" />
              {/* The fit is a straight least-squares line, not a path through the
                  points — joining them up would draw noise as if it were a trend.
                  Shape separates it from the dots, so it needs no second colour. */}
              <ReferenceLine
                segment={leastSquaresSegment(data.correlation)}
                stroke="var(--color-foreground)"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
            </ScatterChart>
          </ChartContainer>
        )}
      </StatCard>
    </div>
  );
}
