import type { RallyTrendPoint } from "@matchpoint/api-client";
import { Ruler } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { LegibleXTick } from "@/components/chart-ticks";
import { StatCard } from "@/components/stat-card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

/**
 * "Rally intensity: how matches are going", one bar per recent match (oldest
 * to most recent, #294/#296), replacing the old point-level rally-length
 * histogram. Same read one level up as `rally-intensity-chart.tsx`'s own
 * per-game version, one level up: not just win/loss across the season, but
 * whether the losses tend to be quick (a short bar, over before it started)
 * or a grind (a tall bar, fought hard, still lost), and which matches,
 * regardless of who won them, went the distance to a deciding set or a
 * match tiebreak.
 *
 * Bar height is `long_rally_share` (0-100%, the share of that match's own
 * bucketed points that ran past 5 shots), not a mean shot count or an
 * average bucket rank: rally length clusters tightly around the "3-5 shots"
 * bucket for most players, so an average barely moves match to match, where
 * the share separates a quick serve-and-volley win from a baseline war.
 *
 * Bar colour is that match's own result: win, loss, or a neutral grey where
 * no result was ever recorded, never a stand-in guess. A won bar is a plain
 * solid fill; a lost one carries the same diagonal-stripe texture the rest
 * of the app uses for a loss (`pattern-unforced`), so the two stay
 * distinguishable in grayscale on a single isolated bar with no neighbouring
 * bar of the other colour to compare against. "Went the distance" is a
 * fourth, independent fact (a match can be short and still have gone to a
 * decider), so it's a separate amber marker above the bar rather than a
 * fifth bar treatment crowding out the win/loss read.
 */

function barFill(result: RallyTrendPoint["result"]): string {
  if (result === "win") return "var(--color-outcome-win)";
  if (result === "loss") return "url(#chart-pattern-loss)";
  // Neither win nor loss — a match nobody has recorded the result of yet.
  // Never guessed at, so it gets its own honest neutral fill.
  return "var(--muted-foreground)";
}

const textHalo = {
  stroke: "var(--color-card)",
  strokeWidth: 2,
  strokeLinejoin: "round" as const,
  paintOrder: "stroke" as const,
};

interface RallyBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: RallyTrendPoint;
}

/** The bar itself, plus a small amber diamond above it when this match went
 *  the distance — its own independent fact, drawn on top rather than folded
 *  into the bar's own win/loss colour. */
function RallyBar({ x = 0, y = 0, width = 0, height = 0, payload }: RallyBarProps) {
  const fill = barFill(payload?.result ?? null);
  const cx = x + width / 2;
  const markerSize = 5;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />
      {payload?.went_the_distance && (
        <path
          d={`M ${cx} ${y - 12 - markerSize} L ${cx + markerSize} ${y - 12} L ${cx} ${y - 12 + markerSize} L ${cx - markerSize} ${y - 12} Z`}
          fill="var(--color-outcome-forced)"
          {...textHalo}
        />
      )}
    </g>
  );
}

function YTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      style={{ fill: "var(--color-foreground)", fontSize: 10, fontWeight: 700 }}
    >
      {payload?.value ?? 0}%
    </text>
  );
}

function Swatch({ className, children }: { className?: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        aria-hidden="true"
        className={`swatch-halo size-2.5 shrink-0 rounded-[2px] ${className}`}
      />
      {children}
    </span>
  );
}

export function RallyHypnogram({ trend }: { trend: RallyTrendPoint[] }) {
  // A stale snapshot restored from the persisted query cache (query-persist.ts) can
  // predate this field existing on RallyStats at all, if the app version wasn't
  // bumped the release it landed in — a required type at the TS layer, not a
  // runtime guarantee against an old cached response. Falling back to an empty
  // array here is what keeps that mismatch an empty state rather than a crash.
  const safeTrend = trend ?? [];

  return (
    <StatCard>
      <div className="flex items-center gap-3">
        <Ruler className="size-9 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-base font-bold">Rally intensity: how matches are going</p>
          <p className="text-xs text-muted-foreground">
            Share of that match's points running past 5 shots · oldest to most recent
          </p>
        </div>
      </div>

      {safeTrend.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No matches with a rally length recorded yet.
        </p>
      ) : (
        <>
          <ChartContainer
            config={{ long_rally_share: { label: "Rally intensity" } }}
            className="aspect-[5/3] w-full"
          >
            {/* Extra top margin: the "went the distance" marker draws above
                the bar itself, and a 100% bar otherwise reaches the plot
                area's very top edge with nothing left to
                draw the marker into. */}
            <BarChart data={safeTrend} margin={{ top: 20 }}>
              {/* A literal inline `<defs>`, not a wrapped component: Recharts'
                  own docs only ever show gradients this way, and that turned
                  out to matter — a `<defs>` behind a named wrapper component
                  (tried first here) rendered the bars fine but broke the
                  tooltip specifically on hover. See `chart-patterns.tsx`'s
                  own warning on `CategoricalPatternDefs` for the same trap. */}
              <defs>
                <pattern
                  id="chart-pattern-loss"
                  width="10"
                  height="10"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="10" height="10" fill="var(--color-outcome-unforced)" />
                  <rect width="5" height="10" fill="black" fillOpacity="0.5" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="match" tickLine={false} axisLine={false} tick={<LegibleXTick />} />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                width={40}
                tickLine={false}
                axisLine={false}
                tick={<YTick />}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelKey="match"
                    formatter={(_value, _name, _item, _index, payload) => {
                      const point = payload as unknown as RallyTrendPoint;
                      const result =
                        point.result === "win"
                          ? "Won"
                          : point.result === "loss"
                            ? "Lost"
                            : "No result yet";
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">
                            {point.long_rally_share}% of points past 5 shots
                          </span>
                          <span className="text-muted-foreground">
                            {result}
                            {point.went_the_distance ? " · Went the distance" : ""}
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Bar dataKey="long_rally_share" shape={<RallyBar />} />
            </BarChart>
          </ChartContainer>

          <div className="flex flex-wrap gap-3">
            <Swatch className="bg-outcome-win">Won</Swatch>
            <Swatch className="pattern-unforced">Lost</Swatch>
            <Swatch className="bg-muted-foreground">No result yet</Swatch>
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M5 0 L10 5 L5 10 L0 5 Z" fill="var(--color-outcome-forced)" />
              </svg>
              Went the distance
            </span>
          </div>

          <div className="flex justify-between gap-3 text-xs font-medium text-foreground">
            <span>Low → dominant, fast points.</span>
            <span className="text-right">High → grinding baseline battles.</span>
          </div>
        </>
      )}
    </StatCard>
  );
}
