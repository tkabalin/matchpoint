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
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { BreakdownBars } from "@/components/breakdown-bars";
import { OutcomeStack } from "@/components/outcome-swatch";
import { SegmentedControl } from "@/components/segmented-control";
import { ShotRadar } from "@/components/shot-radar";
import { StatCard } from "@/components/stat-card";
import { StatHero } from "@/components/stat-hero";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { getRallyStatsOptions } from "@/lib/analytics/analytics-options";
import type {
  BreakdownRow,
  PointEnderStyle,
  RallyLengthBucket,
} from "@/lib/analytics/types.provisional";
import { PATTERN_VAR } from "@/lib/palette";
import { cn } from "@/lib/utils";

import { CourtHeatmap } from "../court-heatmap";

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

export function RallyTab({ playerId }: { playerId: string }) {
  const [wonSide, setWonSide] = useState<WonSide>("you");
  const { data, isPending, isError } = useQuery(
    getRallyStatsOptions({ path: { player_id: playerId } }),
  );
  // Starts closed, and stays closed on its own: nothing auto-opens on load or
  // on switching You won/They won, only a tap on a style card opens its own
  // drill, and tapping that same card again closes it.
  const [openStyle, setOpenStyle] = useState<string | null>(null);

  if (isPending) return <Skeleton className="h-96 w-full" />;

  // A fixture can't fail, but the real endpoint this stands in for can — a
  // 500 or an offline load must not leave this indefinitely skeletoned (#221's
  // own "known pitfalls" section calls this exact pattern out).
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load rally stats.</AlertDescription>
      </Alert>
    );
  }

  const styles = data.styles[wonSide];

  const shotFrequency = data.shotFrequency[wonSide];
  const placementNote = data.placementNote[wonSide];
  const openedStyle = styles.find((style) => style.kind === openStyle) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <RallyLengthCard buckets={data.rallyLength} />

      <StatCard title="Point enders">
        <StatHero icon={Swords} value={String(data.hero.value)} label={data.hero.label} />
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
// `ChartContainer` styles every tick's `<text>` to `fill-muted-foreground` via a
// stylesheet rule, which beats a plain `fill` attribute passed through
// `tick={{...}}` (a presentation attribute loses to any same-property CSS rule,
// however low its specificity). A custom tick using `style` — a real inline
// style, which does win — is the only way to make this axis read darker and
// larger than the app's other, lower-stakes charts.
function LegibleXTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string | number };
}) {
  return (
    <text
      x={x}
      y={y}
      dy={12}
      textAnchor="middle"
      style={{ fill: "var(--color-foreground)", fontSize: 11, fontWeight: 700 }}
    >
      {payload?.value}
    </text>
  );
}

function LegibleYTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string | number };
}) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      style={{ fill: "var(--color-foreground)", fontSize: 11, fontWeight: 700 }}
    >
      {payload?.value}
    </text>
  );
}

function RallyLengthCard({ buckets }: { buckets: RallyLengthBucket[] }) {
  const config = { count: { label: "Points", color: "var(--color-chart-1)" } };
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
          <Bar dataKey="count" fill="var(--color-chart-1)" radius={2} />
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
    : (style.detail.unusualReasons ?? []).map((row) => ({ label: row.label, value: row.value }));
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

function StyleDrill({ style, flipCourt }: { style: PointEnderStyle; flipCourt: boolean }) {
  const { wing, shotType, courtZones, unusualReasons } = style.detail;

  if (!wing) {
    return (
      <div className="border-t pt-3">
        <p className="mb-2 text-base font-bold text-foreground">Reason</p>
        <BreakdownBars rows={unusualReasons ?? []} pattern="indigo" />
      </div>
    );
  }

  const wingTotal = wing.forehand + wing.backhand;

  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-base font-bold text-foreground">Wing: setup shot</p>
      {wingTotal > 0 && (
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
      )}

      <p className="mt-3 mb-2 text-base font-bold text-foreground">Shot type</p>
      <BreakdownBars
        rows={shotType}
        pattern="indigo"
        icon={(row: BreakdownRow) => SHOT_TYPE_ICON[row.label] ?? TrendingUp}
      />

      <p className="mt-3 mb-2 text-base font-bold text-foreground">Final ball: where it landed</p>
      <CourtHeatmap zones={courtZones} flip={flipCourt} />
    </div>
  );
}
