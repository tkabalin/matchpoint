import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ArrowUp,
  CircleCheck,
  CircleX,
  Flag,
  FlagOff,
  Grid2x2,
  ChevronRight,
  Shield,
  Target,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { BreakdownBars } from "@/components/breakdown-bars";
import { SegmentedControl } from "@/components/segmented-control";
import { OutcomeStack } from "@/components/outcome-swatch";
import { StatCard } from "@/components/stat-card";
import { StatHero } from "@/components/stat-hero";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { getMatchServeStatsOptions, getServeStatsOptions } from "@/lib/analytics/analytics-options";
import type {
  BreakdownRow,
  PhaseFilter,
  ReturnOutcomeSplit,
  ServeNumber,
  ServeSideStats,
  SetFilter,
} from "@/lib/analytics/types.provisional";
import { PATTERN_VAR } from "@/lib/palette";
import { cn } from "@/lib/utils";

const FAULT_MODE_ICON: Record<string, typeof Grid2x2> = {
  Net: Grid2x2,
  Long: ArrowUp,
  Wide: ArrowLeftRight,
  In: CircleCheck,
};

export function ServeTab({
  playerId,
  matchId,
  set = "all",
  phase = "full",
  opponentId = null,
}: {
  playerId: string;
  /** Scopes to one match's own analytics instead of the whole player, for
   *  the per-match stats page — same tab, different (still fixture) data. */
  matchId?: string;
  set?: SetFilter;
  phase?: PhaseFilter;
  opponentId?: string | null;
}) {
  const { data, isPending, isError } = useQuery(
    matchId
      ? getMatchServeStatsOptions({ path: { match_id: matchId }, query: { set, phase } })
      : getServeStatsOptions({ path: { player_id: playerId }, query: { set, phase, opponentId } }),
  );

  if (isPending) return <Skeleton className="h-96 w-full" />;

  // A fixture can't fail, but the real endpoint this stands in for can — a
  // 500 or an offline load must not leave this indefinitely skeletoned (#221's
  // own "known pitfalls" section calls this exact pattern out).
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load serve stats.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ServeSideCard
        title="Your serve"
        heroIcon={Target}
        trendTitle="Serve % in"
        stats={data.serving}
      />
      <ServeSideCard
        title="Their serve"
        heroIcon={Shield}
        trendTitle="Their serve % in"
        stats={data.returning}
        returnOutcome={data.returning.returnOutcome}
      />
    </div>
  );
}

function ServeSideCard({
  title,
  heroIcon: HeroIcon,
  trendTitle,
  stats,
  returnOutcome,
}: {
  title: string;
  /** Distinct per card — serving and returning are different actions and should
   *  never share a symbol, even though both are "the serve". */
  heroIcon: LucideIcon;
  trendTitle: string;
  stats: ServeSideStats;
  returnOutcome?: ReturnOutcomeSplit;
}) {
  const [expanded, setExpanded] = useState(false);
  const [serveNumber, setServeNumber] = useState<ServeNumber>("first");

  // Everything below reads from this one selection — the hero, the stack and
  // the fault-mode/return-outcome drill all move together when the 1st/2nd
  // serve toggle changes, rather than only the drill responding to it.
  const outcome = serveNumber === "first" ? stats.outcome.firstServe : stats.outcome.secondServe;
  const outcomeTotal = outcome.in + outcome.fault + outcome.ace;
  const heroLabel = serveNumber === "first" ? "1st serves in" : "2nd serves in";
  const faultMode =
    serveNumber === "first" ? stats.faultMode.firstServe : stats.faultMode.secondServe;
  const returnRows = returnOutcome
    ? serveNumber === "first"
      ? returnOutcome.firstServe
      : returnOutcome.secondServe
    : undefined;

  return (
    <StatCard>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-base font-bold text-foreground">{title}</span>
        <ChevronRight
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>

      {/* Value derived from `outcome`, ace-inclusive — an ace is still an "in"
          serve, so the headline % in has to include it, and computing it from
          the same numbers the stack below draws is what keeps the two from
          disagreeing. Both read from the 1st/2nd serve toggle's current
          selection, not a fixed value that ignores it. */}
      <StatHero icon={HeroIcon} value={`${outcome.in + outcome.ace}%`} label={heroLabel} />

      {outcomeTotal > 0 && (
        <OutcomeStack
          segments={[
            // "In" here means landed in and wasn't an ace — a disjoint third of
            // the stack, not a superset of the ace segment below it. Together,
            // in + ace is the headline % in shown above.
            { pattern: "win", weight: outcome.in, label: `${outcome.in}% in` },
            {
              pattern: "unforced",
              weight: outcome.fault,
              label: `${outcome.fault}% fault`,
            },
            { pattern: "violet", weight: outcome.ace, label: `${outcome.ace}% ace` },
          ]}
        />
      )}
      <div className="flex gap-4">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CircleCheck className="size-6 text-outcome-win" aria-hidden="true" />
          In
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CircleX className="size-6 text-outcome-unforced" aria-hidden="true" />
          Fault
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Zap className="size-6" style={{ color: PATTERN_VAR.violet }} aria-hidden="true" />
          Ace
        </span>
      </div>

      <ServeTrendChart title={trendTitle} trend={stats.trend} />

      {expanded && (
        <div className="border-t pt-3">
          <SegmentedControl
            aria-label="1st or 2nd serve"
            value={serveNumber}
            onValueChange={setServeNumber}
            options={[
              { value: "first", label: "1st serve", icon: Flag },
              { value: "second", label: "2nd serve", icon: FlagOff },
            ]}
          />
          <p className="mt-3 mb-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
            {returnOutcome ? "Their fault mode" : "Fault mode"}
          </p>
          <BreakdownBars
            rows={[
              { label: "Net", value: faultMode.net, max: 100 },
              { label: "Long", value: faultMode.long, max: 100 },
              { label: "Wide", value: faultMode.wide, max: 100 },
            ]}
            pattern="unforced"
            icon={(row: BreakdownRow) => FAULT_MODE_ICON[row.label]!}
            unit="%"
          />

          {returnRows && (
            <>
              <p className="mt-3 mb-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                Your return outcome
              </p>
              <BreakdownBars
                rows={returnRows}
                pattern={(row) => (row.label === "In" ? "win" : "unforced")}
                icon={(row: BreakdownRow) => FAULT_MODE_ICON[row.label]!}
                unit="%"
              />
            </>
          )}
        </div>
      )}
    </StatCard>
  );
}

function ServeTrendChart({ title, trend }: { title: string; trend: ServeSideStats["trend"] }) {
  // "% in" everywhere here means the same thing the hero number above means for the
  // whole sample: the share of serve attempts at that serve number (1st or 2nd)
  // that landed in play — a fault or a let-replay doesn't count, an ace does. Each
  // line is that rate for one match, oldest (M1) to most recent, so a coach sees
  // the trend behind today's headline number, not just its current value.
  const config = {
    firstServeIn: { label: "1st serve % in", color: PATTERN_VAR.yellow },
    secondServeIn: { label: "2nd serve % in", color: PATTERN_VAR.indigo },
  };

  return (
    <div>
      <p className="mb-1 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
        {title} · share of serve attempts landing in, per match · last {trend.length} matches
      </p>
      <ChartContainer config={config} className="aspect-[5/2] w-full">
        <LineChart data={trend}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="match" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
          <YAxis
            width={28}
            domain={[0, 100]}
            tick={{ fontSize: 9 }}
            tickFormatter={(value: number) => `${value}%`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                // Keyed by series (`name` is the line's own dataKey), not by
                // payload position — a match with no 2nd serve renders a
                // single-entry payload at index 0, which used to mislabel
                // whichever line actually survived as "1st serve".
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {name === "firstServeIn" ? "1st serve" : "2nd serve"}
                    </span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {value}%
                    </span>
                  </div>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line dataKey="firstServeIn" stroke={PATTERN_VAR.yellow} strokeWidth={2} dot={false} />
          <Line dataKey="secondServeIn" stroke={PATTERN_VAR.indigo} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
