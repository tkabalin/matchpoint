import type {
  FaultModeShares,
  ReturnOutcomeRow,
  ReturnOutcomeSplit,
  ServeOutcomeShares,
  ServeSideStats,
} from "@matchpoint/api-client";
import {
  getMatchServeStatsOptions,
  getServeStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Flag, FlagOff, Shield, Spade, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect } from "react";

import { FaultModeCourt } from "@/components/fault-mode-court";
import { OutcomeStack } from "@/components/outcome-swatch";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toSetNumber } from "@/lib/analytics/filter-options";
import type { PhaseFilter, SetFilter, SurfaceFilter } from "@/lib/analytics/types.provisional";
import { getErrorStatus } from "@/lib/error-status";
import { PATTERN_VAR } from "@/lib/palette";
import { cn } from "@/lib/utils";

export function ServeTab({
  playerId,
  matchId,
  set = "all",
  phase = "full",
  opponentKey = null,
  surface = "all",
  onOpponentNotFound,
}: {
  playerId: string;
  /** Scopes to one match's own analytics instead of the whole player, for
   *  the per-match stats page — same tab, different data. */
  matchId?: string;
  set?: SetFilter;
  phase?: PhaseFilter;
  /** Narrows to one opponent via the real `opponent_key` axis — null (or
   *  omitted) means every opponent. Never sent on a match-scoped request: a
   *  match already has exactly one opponent. */
  opponentKey?: string | null;
  /** Narrows to one surface via the real `surface` axis (#225) — `"all"` (or
   *  omitted) means every surface. Never sent on a match-scoped request: a
   *  match already has exactly one surface. */
  surface?: SurfaceFilter;
  /** Called once if the committed opponent key doesn't match any of this
   *  player's real matches — a stale picker selection, not a bug to report.
   *  The caller falls back to "all matches" rather than leaving this tab
   *  stuck on an error (see `analytics.py`'s own `OPPONENT_NOT_FOUND`
   *  comment: "a stale key sends the panel back to all matches"). */
  onOpponentNotFound?: () => void;
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
      query: {
        set_number: setNumber,
        phase,
        opponent_key: opponentKey,
        surface: surface === "all" ? undefined : surface,
      },
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
  const { data, isPending, isError, error } = matchId === undefined ? playerQuery : matchQuery;
  const opponentNotFound =
    matchId === undefined && opponentKey !== null && getErrorStatus(error) === 404;

  useEffect(() => {
    if (opponentNotFound) onOpponentNotFound?.();
  }, [opponentNotFound, onOpponentNotFound]);

  if (isPending || opponentNotFound) return <Skeleton className="h-96 w-full" />;

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
      <YourServeCard stats={data.serving} />
      <OpponentServeCard stats={data.returning} />
    </div>
  );
}

function CardHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-9 shrink-0 text-primary" aria-hidden="true" />
      <p className="text-base font-bold text-foreground">{title}</p>
    </div>
  );
}

function OutcomeLegendRow({
  items,
}: {
  items: { icon: LucideIcon; iconClassName?: string; iconStyle?: CSSProperties; text: string }[];
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-4">
      {items.map((item) => (
        <span
          key={item.text}
          className="flex items-center gap-1.5 text-xs font-bold text-foreground"
        >
          <item.icon
            className={cn("size-5", item.iconClassName)}
            style={item.iconStyle}
            aria-hidden="true"
          />
          {item.text}
        </span>
      ))}
    </div>
  );
}

function YourServeCard({ stats }: { stats: ServeSideStats }) {
  return (
    <StatCard>
      <CardHeading icon={Target} title="Your serve" />
      <ServeOutcomeRow icon={Flag} label="1st serve" outcome={stats.outcome.first_serve} />
      <ServeOutcomeRow icon={FlagOff} label="2nd serve" outcome={stats.outcome.second_serve} />
      <FaultModeSection
        first={stats.fault_mode.first_serve}
        second={stats.fault_mode.second_serve}
      />
    </StatCard>
  );
}

/** One permanent bar per serve number — no toggle, no drill: both the stack and its
 *  in/fault/ace percentages are always on screen, since a hidden number "can't be
 *  determined" at a glance. */
function ServeOutcomeRow({
  icon,
  label,
  outcome,
}: {
  icon: LucideIcon;
  label: string;
  outcome: ServeOutcomeShares | null;
}) {
  const Icon = icon;

  if (!outcome) {
    return (
      <div>
        <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </span>
        <p className="text-xs text-muted-foreground">No {label.toLowerCase()}s recorded yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </span>
        <span className="text-lg font-bold tabular-nums">{outcome.landed + outcome.ace}% in</span>
      </div>
      <OutcomeStack
        className="mt-1"
        segments={[
          { pattern: "win", weight: outcome.landed, label: `${outcome.landed}% in` },
          { pattern: "unforced", weight: outcome.fault, label: `${outcome.fault}% fault` },
          // Sky, a scoped 8th categorical color (.claude/rules/web-color.md's
          // "Serve/Rally — sky" entry) — not the nav's own primary blue, a
          // separate light-blue-with-white-dots swatch. Both indigo and
          // yellow were tried here first and reported too close to
          // vermillion's "fault" segment sitting right next to it in this
          // thin bar; violet is off the table outright (vermillion/violet
          // must never share a view).
          { pattern: "sky", weight: outcome.ace, label: `${outcome.ace}% ace` },
        ]}
      />
      <OutcomeLegendRow
        items={[
          { icon: CircleCheck, iconClassName: "text-outcome-win", text: `${outcome.landed}% in` },
          {
            icon: CircleX,
            iconClassName: "text-outcome-unforced",
            text: `${outcome.fault}% fault`,
          },
          { icon: Spade, iconStyle: { color: PATTERN_VAR.sky }, text: `${outcome.ace}% ace` },
        ]}
      />
    </div>
  );
}

function OpponentServeCard({ stats }: { stats: ServeSideStats }) {
  const split = combinedReturnSplit(stats.return_outcome);

  return (
    <StatCard>
      <CardHeading icon={Shield} title="Return of opponent serve" />
      {split ? (
        <ReturnSplitRow inPercent={split.inPercent} errorPercent={split.errorPercent} />
      ) : (
        <p className="text-xs text-muted-foreground">No returns recorded yet.</p>
      )}
      <CombinedFaultModeSection
        shares={combinedFaultShares(
          stats.return_outcome.first_serve,
          stats.return_outcome.second_serve,
        )}
      />
    </StatCard>
  );
}

/** The opponent's own serve, from the one side capture actually records: not what
 *  proportion of it landed in or out (nobody's tracking the opponent's toss), but
 *  what the tracked player did with it once it arrived — one bar, in vs. error,
 *  first and second serve combined. */
function ReturnSplitRow({ inPercent, errorPercent }: { inPercent: number; errorPercent: number }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">Your return</span>
        <span className="text-lg font-bold tabular-nums">{inPercent}% in</span>
      </div>
      <OutcomeStack
        className="mt-1"
        segments={[
          { pattern: "win", weight: inPercent, label: `${inPercent}% in` },
          { pattern: "unforced", weight: errorPercent, label: `${errorPercent}% error` },
        ]}
      />
      <OutcomeLegendRow
        items={[
          { icon: CircleCheck, iconClassName: "text-outcome-win", text: `${inPercent}% in` },
          {
            icon: CircleX,
            iconClassName: "text-outcome-unforced",
            text: `${errorPercent}% error`,
          },
        ]}
      />
    </div>
  );
}

/** Two courts side by side, one serve number each, with a clear rule between them —
 *  the fault-mode equivalent of the two outcome rows above. "Your serve" only:
 *  the opponent card shows one court combined across both serve numbers instead
 *  (`CombinedFaultModeSection`), since there's no separate 1st/2nd outcome row to
 *  pair each court with on that card the way there is here. */
function FaultModeSection({
  first,
  second,
}: {
  first: FaultModeShares | null;
  second: FaultModeShares | null;
}) {
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-sm font-bold text-foreground">Fault breakdown</p>
      <div className="grid grid-cols-2">
        <FaultModeColumn icon={Flag} label="1st serve" shares={first} />
        <FaultModeColumn
          icon={FlagOff}
          label="2nd serve"
          shares={second}
          className="border-l-2 border-muted-foreground/40 pl-3"
        />
      </div>
    </div>
  );
}

function FaultModeColumn({
  icon: Icon,
  label,
  shares,
  className,
}: {
  icon: LucideIcon;
  label: string;
  shares: FaultModeShares | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <span className="flex items-center gap-1 text-xs font-bold text-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </span>
      {shares ? (
        <FaultModeCourt shares={shares} />
      ) : (
        <p className="text-center text-xs text-muted-foreground">No faults on this serve yet.</p>
      )}
    </div>
  );
}

/** The opponent card's own fault-mode section: one court, combined across both
 *  serve numbers — unlike "Your serve", this card has no per-serve-number
 *  outcome row for two separate courts to pair with. */
function CombinedFaultModeSection({ shares }: { shares: FaultModeShares | null }) {
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-sm font-bold text-foreground">Error breakdown</p>
      {shares ? (
        <div className="flex justify-center">
          <FaultModeCourt shares={shares} />
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">No faults on this serve yet.</p>
      )}
    </div>
  );
}

function rowValue(rows: ReturnOutcomeRow[], label: string): number {
  return rows.find((row) => row.label === label)?.value ?? 0;
}

function rowCount(rows: ReturnOutcomeRow[], label: string): number {
  return rows.find((row) => row.label === label)?.count ?? 0;
}

/** Both serve numbers' own "In" share, averaged unweighted: an even split across
 *  1st/2nd is nothing worse than the independent rounding either side already
 *  carries. The returns behind each percentage now come with it (#295), so a
 *  weighted combine lands with this card's own switch to raw counts. */
function combinedReturnSplit(
  split: ReturnOutcomeSplit,
): { inPercent: number; errorPercent: number } | null {
  const inRates = [split.first_serve, split.second_serve]
    .filter((rows) => rows.length > 0)
    .map((rows) => rowValue(rows, "In"));
  if (inRates.length === 0) return null;

  const inPercent = Math.round(inRates.reduce((sum, rate) => sum + rate, 0) / inRates.length);
  return { inPercent, errorPercent: 100 - inPercent };
}

/** The tracked player's own return faults, net/long/wide — the same court shape as
 *  the serving card's own fault mode, just facing the other way (`FaultModeSection`'s
 *  `flip`), since it's built from the same three landing zones on the same court. */
function returnFaultShares(rows: ReturnOutcomeRow[]): FaultModeShares | null {
  if (rows.length === 0) return null;
  return {
    net: rowValue(rows, "Net"),
    long: rowValue(rows, "Long"),
    wide: rowValue(rows, "Wide"),
    net_count: rowCount(rows, "Net"),
    long_count: rowCount(rows, "Long"),
    wide_count: rowCount(rows, "Wide"),
  };
}

/** `returnFaultShares` for both serve numbers, summed into one. Each side's three
 *  values are already its own independent ~100 (renormalised again by
 *  `FaultModeCourt` regardless), so summing two comparable-scale shares and
 *  letting that renormalisation take relative proportions is the same
 *  unweighted-combine approximation `combinedReturnSplit` above already uses.
 *  The counts sum as plain counts, which is where a weighted one would read them. */
function combinedFaultShares(
  first: ReturnOutcomeRow[],
  second: ReturnOutcomeRow[],
): FaultModeShares | null {
  const firstShares = returnFaultShares(first);
  const secondShares = returnFaultShares(second);
  if (!firstShares && !secondShares) return null;

  const empty = { net: 0, long: 0, wide: 0, net_count: 0, long_count: 0, wide_count: 0 };
  const a = firstShares ?? empty;
  const b = secondShares ?? empty;
  return {
    net: a.net + b.net,
    long: a.long + b.long,
    wide: a.wide + b.wide,
    net_count: a.net_count + b.net_count,
    long_count: a.long_count + b.long_count,
    wide_count: a.wide_count + b.wide_count,
  };
}
