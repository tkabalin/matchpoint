import type { BreakdownRow, PlayerRead, SquadMemberStats } from "@matchpoint/api-client";
import { getRallyStatsOptions, getServeStatsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChartColumn,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  type LucideIcon,
  Play,
  Rainbow,
  Ruler,
  Shield,
  Swords,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { ForcedUnforcedBalance } from "@/components/forced-unforced-balance";
import { PlayerAvatar } from "@/components/player-avatar";
import { ResultDots } from "@/components/result-dots";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { attentionFor } from "@/lib/analytics/attention";
import { PATTERN_CLASS } from "@/lib/palette";
import { setLastViewedPlayerId } from "@/lib/last-viewed-player";
import { useInView } from "@/lib/use-in-view";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Same mapping shot-radar.tsx and rally-tab.tsx already use for these four shot
// types — see .claude/rules/web-icons.md's Shot type rows.
const SHOT_TYPE_ICON: Record<string, LucideIcon> = {
  Drive: TrendingUp,
  Volley: ChevronUp,
  "Drop shot": ChevronDown,
  Lob: Rainbow,
};

/**
 * A returns-into-play percentage from raw counts: `returning.breakdown` pools
 * both serve numbers already (unlike `return_outcome`, which stays split by
 * serve number), so this is the one combined figure the mockup wants.
 */
function returnInPercent(breakdown: BreakdownRow[]): number | null {
  const returnedIn = breakdown.find((row) => row.label === "Returned in")?.value ?? 0;
  const total = breakdown.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return null;
  return Math.round((100 * returnedIn) / total);
}

/** One stat, icon + bold label + bold value, with its own fill bar underneath
 *  (a single percentage bar, or a two-way `OutcomeStack` split). Every stat on
 *  this card reads at the same size and weight — a coach glancing at it
 *  courtside shouldn't have to find the small print. */
function StatRow({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="size-6 shrink-0 text-foreground" aria-hidden="true" />
      <div className="flex-1">
        <div className="flex justify-between text-sm font-bold text-foreground">
          <span>{label}</span>
          <span className="tabular-nums">{value}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** `StatRow`'s label/value pair assumes a wide row, splitting the two apart
 *  with `justify-between` — in the narrower Winning-shots column that wraps
 *  label and value independently, so the two rows land out of step with each
 *  other. This is one left-aligned line instead: label, an arrow pointing at
 *  the shot itself, then the shot and its share, wrapping as one unit if it
 *  has to rather than each half wrapping on its own. */
function ShotStatRow({
  icon: Icon,
  label,
  shot,
  share,
  intensity,
}: {
  icon: LucideIcon;
  label: string;
  shot: string;
  share: number;
  intensity: "strong" | "faint";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="size-6 shrink-0 text-foreground" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-sm font-bold text-foreground">
          {label} <span aria-hidden="true">→</span> {shot} ({Math.round(share * 100)}%)
        </p>
        <ShotStreak share={share} intensity={intensity} />
      </div>
    </div>
  );
}

/** A streak instead of a fill bar, at Danny's request: a shot a player leans on
 *  is drawn as a thick, glowing sweep with a bright leading edge, the shot they
 *  barely play as a thin, faint, dotted trace — the same "comet tail" for both,
 *  just at opposite ends of its own weight and length. One neutral chart color
 *  throughout, since this is a single-player figure, not a category legend. */
function ShotStreak({ share, intensity }: { share: number; intensity: "strong" | "faint" }) {
  const widthPercent = Math.max(share * 100, 10);
  if (intensity === "faint") {
    return (
      <div className="relative mt-1.5 h-3 w-full">
        {/* A border this thin renders as barely-there in most browsers, so the
            dotted trace is a repeating background image instead — a real dash
            pattern rather than a 1px border style that can vanish entirely. */}
        <div
          className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full opacity-70"
          style={{
            width: `${widthPercent}%`,
            backgroundImage:
              "repeating-linear-gradient(to right, var(--color-chart-3) 0 3px, transparent 3px 7px)",
          }}
          aria-hidden="true"
        />
        <div
          className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 opacity-70"
          style={{
            left: `calc(${widthPercent}% - 5px)`,
            borderColor: "var(--color-chart-3)",
            background: "var(--background)",
          }}
          aria-hidden="true"
        />
      </div>
    );
  }
  return (
    <div className="relative mt-1.5 h-3 w-full">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${widthPercent}%`,
          background: "linear-gradient(to right, transparent, var(--color-chart-3))",
        }}
        aria-hidden="true"
      />
      {/* The comet's bright head: a lighter core so it reads as a highlight
          rather than just the tail's own end, plus a background-colored halo
          ring so it separates from the tail behind it (the same "render the
          mark twice" halo pass web-color.md prescribes for a mark that has to
          stand out from a line of its own color). */}
      <div
        className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full"
        style={{
          left: `calc(${widthPercent}% - 8px)`,
          background: "radial-gradient(circle at 35% 35%, white, var(--color-chart-3) 70%)",
          boxShadow: "0 0 0 2px var(--background), 0 0 10px 2px var(--color-chart-3)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}

const COURT_WIDTH = 200;
const COURT_HEIGHT = 64;
const COURT_MARGIN = 6;
const NET_X = COURT_WIDTH / 2;
const ROW_LOST_Y = 24;
const ROW_WON_Y = 44;
const MAX_LINE_LENGTH = NET_X - COURT_MARGIN - 14;
const MIN_LINE_LENGTH = 10;

/** A line length in svg units, both sides sharing one ceiling: a real zero
 *  still gets a sliver so it reads as measured-and-zero rather than no data
 *  at all; `null` (no side to show) gets none. */
function lineLength(value: number | null, ceiling: number): number {
  if (value === null || ceiling === 0) return 0;
  if (value === 0) return 4;
  return Math.max((value / ceiling) * MAX_LINE_LENGTH, MIN_LINE_LENGTH);
}

/** Rally length on a top-view court, at Danny's request: two arcs side by
 *  side made close values hard to tell apart (a small peak-height difference
 *  is subtle to eyeball), so this is two straight lines instead, each in its
 *  own stacked row but both anchored at the same net position — sharing one
 *  reference point turns "which is longer" into a direct read of where each
 *  line ends, rather than comparing two curves. Lost grows left toward its
 *  baseline, Won grows right toward its own. */
function RallyLengthCourt({
  won,
  lost,
  ceiling,
}: {
  won: number | null;
  lost: number | null;
  ceiling: number;
}) {
  const lostLength = lineLength(lost, ceiling);
  const wonLength = lineLength(won, ceiling);
  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${COURT_WIDTH} ${COURT_HEIGHT}`}
        className="h-14 w-full"
        aria-hidden="true"
      >
        {/* The court: a subtle, dark background, not a data mark — just
            enough for the two lines to read as rallies on a court, not a
            chart with axes. */}
        <rect
          x={COURT_MARGIN}
          y={COURT_MARGIN}
          width={COURT_WIDTH - COURT_MARGIN * 2}
          height={COURT_HEIGHT - COURT_MARGIN * 2}
          rx={4}
          className="fill-court/15 stroke-muted-foreground/30"
          strokeWidth={1.5}
        />
        <line
          x1={NET_X}
          y1={COURT_MARGIN}
          x2={NET_X}
          y2={COURT_HEIGHT - COURT_MARGIN}
          className="stroke-muted-foreground/40"
          strokeWidth={2}
        />
        {/* .claude/rules/web-color.md: two lines shown together must differ in
            both thickness and dash style, never color alone — Lost is
            thinner and dashed, Won is thicker and solid. */}
        {lost !== null && (
          <line
            x1={NET_X}
            y1={ROW_LOST_Y}
            x2={NET_X - lostLength}
            y2={ROW_LOST_Y}
            stroke="var(--color-outcome-unforced)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray="6 4"
            className="motion-safe:animate-neon-pulse"
            style={{ filter: "drop-shadow(0 0 3px var(--color-outcome-unforced))" }}
          />
        )}
        {won !== null && (
          <line
            x1={NET_X}
            y1={ROW_WON_Y}
            x2={NET_X + wonLength}
            y2={ROW_WON_Y}
            stroke="var(--color-outcome-win)"
            strokeWidth={4}
            strokeLinecap="round"
            className="motion-safe:animate-neon-pulse"
            style={{ filter: "drop-shadow(0 0 3px var(--color-outcome-win))" }}
          />
        )}
      </svg>
      <div className="flex justify-between text-sm font-bold text-foreground">
        <span className="flex items-center gap-1.5">
          <CircleX className="size-5 shrink-0" aria-hidden="true" />
          Lost {lost === null ? "—" : lost}
        </span>
        <span className="flex items-center gap-1.5">
          <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
          Won {won === null ? "—" : won}
        </span>
      </div>
    </div>
  );
}

export function PlayerCard({
  player,
  member,
}: {
  player: PlayerRead;
  member: SquadMemberStats | undefined;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const playerName = `${player.first_name} ${player.last_name}`;
  const flag = member ? attentionFor(member)?.reason : undefined;
  const hasLoggedMatches = member ? member.days_since_last_match !== null : false;

  const { data: serveStats } = useQuery({
    ...getServeStatsOptions({ path: { player_id: player.id } }),
    enabled: inView && hasLoggedMatches,
  });
  const { data: rallyStats } = useQuery({
    ...getRallyStatsOptions({ path: { player_id: player.id } }),
    enabled: inView && hasLoggedMatches,
  });

  const servedInPercent = serveStats?.serving.outcome.first_serve
    ? serveStats.serving.outcome.first_serve.landed + serveStats.serving.outcome.first_serve.ace
    : null;
  const returnedInPercent = serveStats ? returnInPercent(serveStats.returning.breakdown) : null;

  // Raw counts, not the ratio: professional stats report forced/unforced as two
  // numbers side by side, and it's the only way to tell "12 forcing shots, no
  // mistakes" from "12 forcing shots, 1 mistake" apart (d6434da's own reasoning).
  const forcedCount = rallyStats?.styles.you.find((style) => style.kind === "forced")?.count;
  const unforcedCount = rallyStats?.styles.you.find((style) => style.kind === "unforced")?.count;
  const hasForcedUnforced = forcedCount !== undefined && unforcedCount !== undefined;

  const rallyCeiling = rallyStats
    ? Math.max(
        rallyStats.average_rally_length.won ?? 0,
        rallyStats.average_rally_length.lost ?? 0,
        1,
      )
    : 1;

  // The radar this replaced squashed Volley/Lob/Drop shot toward the centre no
  // matter how it was scaled, because Drive dominates nearly every player's
  // mix. Naming the two extremes plainly says what the radar was straining to
  // show — Drive is honestly still allowed to be "most used" here, since that's
  // the real finding, not something to hide a second time.
  const shotFrequency = rallyStats?.shot_frequency.you ?? [];
  const hasShotFrequency = shotFrequency.length > 0;
  const mostUsedShot = hasShotFrequency
    ? shotFrequency.reduce((best, point) => (point.share > best.share ? point : best))
    : null;
  const leastUsedShot = hasShotFrequency
    ? shotFrequency.reduce((worst, point) => (point.share < worst.share ? point : worst))
    : null;
  const hasShotContrast = Boolean(
    mostUsedShot && leastUsedShot && mostUsedShot.shot !== leastUsedShot.shot,
  );

  return (
    <Card ref={ref} className="overflow-hidden py-0">
      {/* Not a link: "View stats" below is the one way to reach the profile now,
          so a chevron here would promise a second one that doesn't exist. `role="group"`
          plus its own label just gives this block a distinct accessible name from the
          in-progress banner (`in-progress-banner.tsx`), which can show this same bare
          player name at the same time — nothing here is interactive. */}
      <div role="group" aria-label={`${playerName}'s card`} className="flex items-center gap-3 p-4">
        <PlayerAvatar player={player} size="md" />
        <div className="flex-1">
          <p className="flex items-center gap-2 text-lg font-bold">
            {playerName}
            {/* #185 owns cancelling a transfer code, from the player's profile. */}
            {player.has_transfer_code && <Badge variant="secondary">Transfer pending</Badge>}
          </p>
          {flag && <p className="text-xs text-outcome-unforced">{flag}</p>}
        </div>
      </div>

      {hasLoggedMatches && member && (
        <CardContent className="flex flex-col gap-3 pb-4">
          <ResultDots results={member.last5_results} />

          <div className="flex flex-col gap-2.5 border-t-2 border-muted-foreground/40 pt-3">
            <p className="text-sm font-bold tracking-wide text-foreground uppercase">All matches</p>

            {servedInPercent !== null && (
              <StatRow
                icon={CircleCheck}
                label="1st serves landing in play"
                value={`${servedInPercent}%`}
              >
                <div className="mt-1 h-2 overflow-hidden rounded-sm bg-muted">
                  <div
                    className={cn("h-full", PATTERN_CLASS.indigo)}
                    style={{ width: `${servedInPercent}%` }}
                  />
                </div>
              </StatRow>
            )}
            {returnedInPercent !== null && (
              <StatRow
                icon={Shield}
                label="Return of serve in play"
                value={`${returnedInPercent}%`}
              >
                <div className="mt-1 h-2 overflow-hidden rounded-sm bg-muted">
                  <div
                    className={cn("h-full", PATTERN_CLASS.indigo)}
                    style={{ width: `${returnedInPercent}%` }}
                  />
                </div>
              </StatRow>
            )}

            {hasForcedUnforced && (
              <StatRow
                icon={Swords}
                label="Your forced : unforced"
                value={`${forcedCount} | ${unforcedCount}`}
              >
                <ForcedUnforcedBalance forced={forcedCount!} unforced={unforcedCount!} />
              </StatRow>
            )}
          </div>

          {(rallyStats?.average_rally_length || hasShotFrequency) && (
            <div className="flex gap-3 border-t-2 border-muted-foreground/40 pt-3">
              {rallyStats?.average_rally_length && (
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex h-7 items-center gap-1.5">
                    <Ruler className="size-5 shrink-0 text-foreground" aria-hidden="true" />
                    <p className="text-base font-bold text-foreground">Rally length</p>
                  </div>
                  {/* The heading stays pinned at the top, level with Winning
                      shots' own heading — it's the chart that moves, centring
                      in whatever space is left once the taller side sets the
                      row's height, not the heading chasing it down. */}
                  <div className="flex flex-1 flex-col justify-center">
                    <RallyLengthCourt
                      won={rallyStats.average_rally_length.won}
                      lost={rallyStats.average_rally_length.lost}
                      ceiling={rallyCeiling}
                    />
                  </div>
                </div>
              )}

              {hasShotFrequency && mostUsedShot && (
                <div
                  className={cn(
                    "flex flex-1 flex-col gap-1.5",
                    // Only a divider when there's actually a Rally length column
                    // on the other side of it — an orphaned border reads as a
                    // stray line once this is the row's only content.
                    rallyStats?.average_rally_length &&
                      "border-l-2 border-muted-foreground/40 pl-3",
                  )}
                >
                  <div className="flex h-7 items-center gap-1.5">
                    <Zap className="size-5 shrink-0 text-foreground" aria-hidden="true" />
                    <p className="text-base font-bold text-foreground">Winning shots</p>
                  </div>
                  <div className="flex flex-1 flex-col justify-center gap-3">
                    <ShotStatRow
                      icon={SHOT_TYPE_ICON[mostUsedShot.shot] ?? TrendingUp}
                      label="Most used"
                      shot={mostUsedShot.shot}
                      share={mostUsedShot.share}
                      intensity="strong"
                    />
                    {hasShotContrast && leastUsedShot && (
                      <ShotStatRow
                        icon={SHOT_TYPE_ICON[leastUsedShot.shot] ?? TrendingUp}
                        label="Least used"
                        shot={leastUsedShot.shot}
                        share={leastUsedShot.share}
                        intensity="faint"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}

      <div className="flex border-t">
        <Link
          to="/players/$playerId"
          params={{ playerId: player.id }}
          onClick={() => setLastViewedPlayerId(player.id)}
          className={cn(buttonVariants({ variant: "outline" }), "flex-1 rounded-none border-0")}
        >
          <ChartColumn />
          View stats
        </Link>
        <Link
          to="/new-match/$playerId"
          params={{ playerId: player.id }}
          className={cn(buttonVariants(), "flex-1 rounded-none border-0 border-l")}
        >
          <Play />
          Start match
        </Link>
      </div>
    </Card>
  );
}
