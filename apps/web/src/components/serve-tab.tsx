import type { BreakdownRow, ServeSideStats } from "@matchpoint/api-client";
import {
  getMatchServeStatsOptions,
  getServeStatsOptions,
} from "@matchpoint/api-client/react-query";
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
import { toSetNumber } from "@/lib/analytics/filter-options";
import type { PhaseFilter, SetFilter } from "@/lib/analytics/types.provisional";
import { PATTERN_VAR } from "@/lib/palette";
import { cn } from "@/lib/utils";

type ServeNumber = "first" | "second";

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
}: {
  playerId: string;
  /** Scopes to one match's own analytics instead of the whole player, for
   *  the per-match stats page — same tab, different data. */
  matchId?: string;
  set?: SetFilter;
  phase?: PhaseFilter;
  /** Not yet threaded through to the query — the scope panel's opponent
   *  picker is still a fixture (#244's real dropdown lands separately), and
   *  its ids don't match the real `opponent_key` the endpoint expects. */
  opponentId?: string | null;
}) {
  const setNumber = toSetNumber(set);
  // Two hooks, one enabled at a time, rather than a ternary choosing which
  // `*Options` call feeds a single `useQuery`: the generated factories have
  // genuinely different query-key types (`match_id` vs `player_id`), which a
  // union can't express as one overload — this is the standard TanStack
  // Query shape for "fetch A or B depending on a prop."
  const playerQuery = useQuery({
    ...getServeStatsOptions({
      path: { player_id: playerId },
      query: { set_number: setNumber, phase },
    }),
    enabled: matchId === undefined,
  });
  const matchQuery = useQuery({
    ...getMatchServeStatsOptions({
      path: { match_id: matchId ?? "" },
      query: { set_number: setNumber, phase },
    }),
    enabled: matchId !== undefined,
  });
  const { data, isPending, isError } = matchId === undefined ? playerQuery : matchQuery;

  if (isPending) return <Skeleton className="h-96 w-full" />;

  // A real network read can fail — a 500 or an offline load must not leave
  // this indefinitely skeletoned (#221's own "known pitfalls" section calls
  // this exact pattern out).
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
        drill="fault-mode"
      />
      <ServeSideCard
        title="Their serve"
        heroIcon={Shield}
        trendTitle="Their serve % in"
        stats={data.returning}
        drill="return-outcome"
      />
    </div>
  );
}

function ServeSideCard({
  title,
  heroIcon: HeroIcon,
  trendTitle,
  stats,
  drill,
}: {
  title: string;
  /** Distinct per card — serving and returning are different actions and should
   *  never share a symbol, even though both are "the serve". */
  heroIcon: LucideIcon;
  trendTitle: string;
  stats: ServeSideStats;
  /** Which drill this card shows when expanded — a caller decision, not one
   *  inferred from the payload: the serving card's own `return_outcome` is
   *  always empty (capture records the player's return of the opponent's
   *  serve and nothing about the opponent's return of theirs), so the two
   *  drills stay exclusive by construction rather than by checking for data. */
  drill: "fault-mode" | "return-outcome";
}) {
  const [expanded, setExpanded] = useState(false);
  const [serveNumber, setServeNumber] = useState<ServeNumber>("first");

  // Everything below reads from this one selection — the hero, the stack and
  // the fault-mode/return-outcome drill all move together when the 1st/2nd
  // serve toggle changes, rather than only the drill responding to it.
  const outcome = serveNumber === "first" ? stats.outcome.first_serve : stats.outcome.second_serve;
  const outcomeTotal = outcome ? outcome.landed + outcome.fault + outcome.ace : 0;
  const heroLabel = serveNumber === "first" ? "1st serves in" : "2nd serves in";
  const faultMode =
    serveNumber === "first" ? stats.fault_mode.first_serve : stats.fault_mode.second_serve;
  const returnRows =
    drill === "return-outcome"
      ? serveNumber === "first"
        ? stats.return_outcome.first_serve
        : stats.return_outcome.second_serve
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
          selection, not a fixed value that ignores it. A dash where that serve
          number has not been attempted: zero would read as a measurement. */}
      <StatHero
        icon={HeroIcon}
        value={outcome ? `${outcome.landed + outcome.ace}%` : "—"}
        label={heroLabel}
      />

      {outcome && outcomeTotal > 0 && (
        <OutcomeStack
          segments={[
            // "In" here means landed in and wasn't an ace — a disjoint third of
            // the stack, not a superset of the ace segment below it. Together,
            // in + ace is the headline % in shown above.
            { pattern: "win", weight: outcome.landed, label: `${outcome.landed}% in` },
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
          {/* Serving side only. Percentages are of that serve number's *faults*,
              not of its attempts — said in the caption because the stack directly
              above is a share of attempts, and two adjacent percentages measuring
              against different denominators is exactly how a coach misreads
              "Net 55%" as "55% of my serves hit the net". */}
          {drill === "fault-mode" && (
            <>
              <p className="mt-3 mb-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                Fault mode · share of faults
              </p>
              {faultMode ? (
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
              ) : (
                <p className="text-xs text-muted-foreground">No faults on this serve yet.</p>
              )}
            </>
          )}

          {returnRows && (
            <>
              <p className="mt-3 mb-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                Your return outcome · share of returns played
              </p>
              {returnRows.length > 0 ? (
                <BreakdownBars
                  rows={returnRows}
                  pattern={(row) => (row.label === "In" ? "win" : "unforced")}
                  icon={(row: BreakdownRow) => FAULT_MODE_ICON[row.label]!}
                  unit="%"
                />
              ) : (
                <p className="text-xs text-muted-foreground">No returns recorded on this serve.</p>
              )}
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
    first_serve_in: { label: "1st serve % in", color: PATTERN_VAR.yellow },
    second_serve_in: { label: "2nd serve % in", color: PATTERN_VAR.indigo },
  };

  // A line needs two points to be a line. One match (what a match-scoped request
  // returns) or none (a side that never served) would otherwise draw axes, a
  // 0-100 scale and a legend naming both series over an empty plot, since every
  // Line here is dot={false} and a single datum leaves no visible mark at all.
  if (trend.length < 2) {
    return (
      <div>
        <p className="mb-1 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {trend.length === 0
            ? "No matches with a serve recorded yet."
            : "One match so far, which is not yet a trend."}
        </p>
      </div>
    );
  }

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
                // payload position — a match with no 2nd serve carries a null
                // `second_serve_in` rather than an absent key, and this used to
                // mislabel whichever line actually survived as "1st serve".
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {name === "first_serve_in" ? "1st serve" : "2nd serve"}
                    </span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {value === null ? "—" : `${value}%`}
                    </span>
                  </div>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {/* A background-colored halo pass under each real line (web-color.md's dual-ring
              halo, the SVG-stroke equivalent): a 2px line loses effective contrast a
              filled swatch of the same color doesn't, even when the raw color already
              passes WCAG on its own. legendType/tooltipType "none" keeps the halo out of
              both, so it never appears as a second series. */}
          <Line
            dataKey="first_serve_in"
            stroke="var(--background)"
            strokeWidth={4}
            dot={false}
            legendType="none"
            tooltipType="none"
          />
          <Line dataKey="first_serve_in" stroke={PATTERN_VAR.yellow} strokeWidth={2} dot={false} />
          <Line
            dataKey="second_serve_in"
            stroke="var(--background)"
            strokeWidth={4}
            dot={false}
            legendType="none"
            tooltipType="none"
          />
          <Line dataKey="second_serve_in" stroke={PATTERN_VAR.indigo} strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
