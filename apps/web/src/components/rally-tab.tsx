import type { BreakdownRow, PointEnderStyle, RallyLengthBucket } from "@matchpoint/api-client";
import {
  getMatchRallyStatsOptions,
  getRallyStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowBigLeftDash,
  ArrowBigRightDash,
  CircleCheck,
  CircleX,
  ChevronDown,
  ChevronUp,
  Rainbow,
  Ruler,
  Sparkle,
  Swords,
  TrendingUp,
  TriangleAlert,
  Wind,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { BreakdownBars } from "@/components/breakdown-bars";
import { LegibleXTick, LegibleYTick } from "@/components/chart-ticks";
import { OutcomeStack } from "@/components/outcome-swatch";
import { SegmentedControl } from "@/components/segmented-control";
import { ShotRadar } from "@/components/shot-radar";
import { StatCard } from "@/components/stat-card";
import { StatHero } from "@/components/stat-hero";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { toSetNumber } from "@/lib/analytics/filter-options";
import type { PhaseFilter, SetFilter, SurfaceFilter } from "@/lib/analytics/types.provisional";
import { getErrorStatus } from "@/lib/error-status";
import { PATTERN_VAR } from "@/lib/palette";
import { cn } from "@/lib/utils";

import { CourtHeatmap } from "./court-heatmap";

type WonSide = "you" | "opponents";

// Distinct from every other icon on this screen — "Forced" used to share Target
// with the Serve tab's "Your serve" hero, which read as the same thing twice.
const STYLE_ICON: Record<PointEnderStyle["kind"], typeof Wind> = {
  forced: Wind,
  unforced: TriangleAlert,
  unusual: Sparkle,
};

const SHOT_TYPE_ICON: Record<string, typeof TrendingUp> = {
  Drive: TrendingUp,
  Volley: ChevronUp,
  Dropshot: ChevronDown,
  Lob: Rainbow,
};

/**
 * The explainer paragraph under the radar. No API field carries this — it's
 * the clearest statement of forced/unforced semantics on the tab, so it lives
 * here as a client constant rather than being dropped once the fixture that
 * used to hold it (`fixtures.ts`) goes away.
 */
const PLACEMENT_NOTE: Record<WonSide, string> = {
  you: "Wing and shot type describe the setup shot: the winner's last shot that landed in. Forced means your shot put the opponent under real pressure and their error (or your winner) followed from that; unforced means they missed a routine ball with no real pressure on it.",
  opponents:
    "Wing and shot type describe the setup shot: the winner's last shot that landed in. Forced means their shot put you under real pressure and your error (or their winner) followed from that; unforced means you missed a routine ball with no real pressure on it.",
};

export function RallyTab({
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
  const [wonSide, setWonSide] = useState<WonSide>("you");
  const setNumber = toSetNumber(set);
  // Two hooks, one enabled at a time — see serve-tab.tsx's own comment on
  // why a ternary choosing which `*Options` call feeds a single `useQuery`
  // doesn't type-check here.
  const playerQuery = useQuery({
    ...getRallyStatsOptions({
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
    ...getMatchRallyStatsOptions({
      path: { match_id: matchId ?? "" },
      query: { set_number: setNumber, phase },
    }),
    enabled: matchId !== undefined,
  });
  const { data, isPending, isError, error } = matchId === undefined ? playerQuery : matchQuery;
  const opponentNotFound =
    matchId === undefined && opponentKey !== null && getErrorStatus(error) === 404;
  // Starts closed, and stays closed on its own: nothing auto-opens on load or
  // on switching You won/They won, only a tap on a style card opens its own
  // drill, and tapping that same card again closes it.
  const [openStyle, setOpenStyle] = useState<string | null>(null);

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
        <AlertDescription>Could not load rally stats.</AlertDescription>
      </Alert>
    );
  }

  const styles = data.styles[wonSide];

  const shotFrequency = data.shot_frequency[wonSide];
  const placementNote = PLACEMENT_NOTE[wonSide];
  const openedStyle = styles.find((style) => style.kind === openStyle) ?? null;
  // Null exactly when no rally-ending point has been recorded at all in this
  // scope — a brand-new player, or a filter combination nothing matches.
  const heroValue = data.hero ? (data.hero.display ?? data.hero.value.toFixed(2)) : "—";

  return (
    <div className="flex flex-col gap-3">
      <RallyLengthCard buckets={data.rally_length} />

      <StatCard title="Point enders">
        <StatHero icon={Swords} value={heroValue} label="Forced : Unforced ratio" />
        <OutcomeStack
          segments={[
            { pattern: "win", weight: data.won, label: `${data.won} won` },
            { pattern: "unforced", weight: data.lost, label: `${data.lost} lost` },
          ]}
        />
        <div className="flex gap-4">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleCheck className="size-6 text-outcome-win" aria-hidden="true" />
            {data.won} won
          </span>
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleX className="size-6 text-outcome-unforced" aria-hidden="true" />
            {data.lost} lost
          </span>
        </div>

        <SegmentedControl
          aria-label="Won or lost"
          value={wonSide}
          // Closes any open drill rather than letting it silently swap to the
          // other side's data under an unchanged heading — the card's own
          // comment already promises this stays closed on its own; switching
          // sides is exactly the case that promise didn't cover.
          onValueChange={(value) => {
            setWonSide(value);
            setOpenStyle(null);
          }}
          options={[
            { value: "you", label: `You won (${data.won})`, icon: CircleCheck },
            { value: "opponents", label: `They won (${data.lost})`, icon: CircleX },
          ]}
        />

        <div>
          <p className="mb-2 text-sm font-bold">
            {wonSide === "you" ? "Your" : "Their"} shot shape: wing × type
          </p>
          <ShotRadar
            className="mx-auto aspect-square w-full max-w-80"
            series={[
              {
                name: "Share of point-enders",
                // chart-1 is a pale, near-white blue in light mode — legible
                // against a dark chart background but not against the card's
                // own light surface. chart-3 is the same dedicated chart hue,
                // just further down its lightness ramp.
                color: "var(--color-chart-3)",
                points: shotFrequency,
              },
            ]}
          />
        </div>

        <p className="rounded-sm bg-muted p-2.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
          {placementNote}
        </p>

        <div>
          <p className="mb-2 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
            Forced · Unforced · Unusual: tap to expand, tap again to collapse
          </p>
          <div className="grid grid-cols-3 gap-2">
            {styles.map((style) => (
              <StyleCard
                key={style.kind}
                style={style}
                open={openStyle === style.kind}
                onClick={() => setOpenStyle(openStyle === style.kind ? null : style.kind)}
              />
            ))}
          </div>
        </div>

        {openedStyle && <StyleDrill style={openedStyle} flipCourt={wonSide === "you"} />}
      </StatCard>
    </div>
  );
}

/**
 * How many shots a point ran to before it ended — not scoped to who won it,
 * since the read this exists for cuts across that: a cluster of points ending in
 * the first few shots usually points to serve or return; a cluster ending only
 * after a long exchange usually points to fitness rather than technique. The
 * middle ground between those two doesn't have one clean read, so it's left
 * uncaptioned rather than forcing a claim onto it.
 */
function RallyLengthCard({ buckets }: { buckets: RallyLengthBucket[] }) {
  // chart-1 is a pale, near-white blue in light mode, illegible against this
  // card's own light surface — same finding as `ShotRadar`'s own comment
  // above, chart-3 is the same dedicated chart hue further down its
  // lightness ramp.
  const config = { count: { label: "Points", color: "var(--color-chart-3)" } };
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <StatCard>
      <div className="flex items-center gap-3">
        <Ruler className="size-9 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-base font-bold">Rally length: how points are ending</p>
          <p className="text-xs text-muted-foreground">
            Shots played before the point ended · n={total}
          </p>
        </div>
      </div>

      <ChartContainer config={config} className="aspect-[5/3] w-full">
        <BarChart data={buckets}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={<LegibleXTick />} />
          <YAxis allowDecimals={false} width={28} tick={<LegibleYTick />} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-chart-3)" radius={2} />
        </BarChart>
      </ChartContainer>

      <div className="flex justify-between gap-3 text-xs font-medium text-foreground">
        <span>Short → often serve or return.</span>
        <span className="text-right">Long → often fitness, not technique.</span>
      </div>
    </StatCard>
  );
}

function StyleCard({
  style,
  open,
  onClick,
}: {
  style: PointEnderStyle;
  open: boolean;
  onClick: () => void;
}) {
  const Icon = STYLE_ICON[style.kind];
  const histRows = style.detail.wing
    ? [
        { label: "FH", value: style.detail.wing.forehand },
        { label: "BH", value: style.detail.wing.backhand },
      ]
    : (style.detail.unusual_reasons ?? []).map((row) => ({ label: row.label, value: row.value }));
  const max = Math.max(1, ...histRows.map((row) => row.value));

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-sm border bg-muted/40 p-2 text-center",
        open && "border-primary bg-primary/5",
      )}
    >
      <Icon className="size-7 text-foreground" aria-hidden="true" />
      <span className="text-[0.5625rem] leading-tight font-bold tracking-wide text-muted-foreground uppercase">
        {style.label.split(" (")[0]}
      </span>
      <span className="text-lg font-bold tabular-nums">{style.count}</span>
      <div className="flex h-8 w-full items-end gap-1">
        {histRows.map((row) => (
          <div key={row.label} className="flex flex-1 flex-col items-center justify-end gap-0.5">
            {/* Data, not chrome — nav blue is reserved for navigation/brand
                (web-color.md), and the bottom nav is visible on this screen.
                `bg-chart-1` is the same non-categorical token the court
                heatmap and the rally-length histogram already use. */}
            <span
              className="w-full rounded-t-[2px] bg-chart-1"
              // The 15% floor keeps a small-but-real count from rendering as
              // an invisible sliver — it must not apply to an actual zero,
              // which needs to read as "none," not "a few."
              style={{ height: `${row.value === 0 ? 0 : Math.max(15, (row.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
    </button>
  );
}

/** Points counted on the card that no breakdown can describe — a point ending on a
 *  missed return records no shot and no final ball, so it is real, counted, and
 *  invisible in every drill below. Saying so is the honest answer; the alternative
 *  is a court diagram confidently reading 0% in every cell under a card saying 3. */
function NothingToBreakDown({ count }: { count: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      {count === 1
        ? "This point ended without a shot to record, so there is nothing to break down."
        : `These ${count} points ended without a shot to record, so there is nothing to break down.`}
    </p>
  );
}

function StyleDrill({ style, flipCourt }: { style: PointEnderStyle; flipCourt: boolean }) {
  const {
    wing,
    shot_type: shotType,
    court_zones: courtZones,
    unusual_reasons: unusualReasons,
  } = style.detail;

  if (!wing) {
    return (
      <div className="border-t pt-3">
        <p className="mb-2 text-base font-bold text-foreground">Reason</p>
        {unusualReasons && unusualReasons.length > 0 ? (
          <BreakdownBars rows={unusualReasons} pattern="indigo" />
        ) : (
          <NothingToBreakDown count={style.count} />
        )}
      </div>
    );
  }

  const wingTotal = wing.forehand + wing.backhand;

  // `wing` being a real object with two zeroes is not the same as no wing at all,
  // and neither is a truthiness check enough to tell them apart. With no wing, no
  // shot type and no zones there is nothing under any of the three headings, so
  // the headings themselves should not appear.
  if (wingTotal === 0 && shotType.length === 0 && courtZones.length === 0) {
    return (
      <div className="border-t pt-3">
        <NothingToBreakDown count={style.count} />
      </div>
    );
  }

  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-base font-bold text-foreground">Wing: setup shot</p>
      {wingTotal > 0 ? (
        <>
          <OutcomeStack
            segments={[
              { pattern: "yellow", weight: wing.forehand, label: `Forehand ${wing.forehand}` },
              { pattern: "violet", weight: wing.backhand, label: `Backhand ${wing.backhand}` },
            ]}
          />
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowBigRightDash
                className="size-6"
                style={{ color: PATTERN_VAR.yellow }}
                aria-hidden="true"
              />
              Forehand {wing.forehand}
            </span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ArrowBigLeftDash
                className="size-6"
                style={{ color: PATTERN_VAR.violet }}
                aria-hidden="true"
              />
              Backhand {wing.backhand}
            </span>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No setup shot recorded.</p>
      )}

      <p className="mt-3 mb-2 text-base font-bold text-foreground">Shot type</p>
      {shotType.length > 0 ? (
        <BreakdownBars
          rows={shotType}
          pattern="indigo"
          icon={(row: BreakdownRow) => SHOT_TYPE_ICON[row.label] ?? TrendingUp}
        />
      ) : (
        <p className="text-xs text-muted-foreground">No shot type recorded.</p>
      )}

      <p className="mt-3 mb-2 text-base font-bold text-foreground">Final ball: where it landed</p>
      {courtZones.length > 0 ? (
        <CourtHeatmap zones={courtZones} flip={flipCourt} />
      ) : (
        <p className="text-xs text-muted-foreground">No final ball recorded.</p>
      )}
    </div>
  );
}
