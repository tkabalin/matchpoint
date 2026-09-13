import type { BreakdownRow, PlayerRead, SquadMemberStats } from "@matchpoint/api-client";
import { getRallyStatsOptions, getServeStatsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChartColumn,
  CircleCheck,
  CircleX,
  type LucideIcon,
  Play,
  Ruler,
  Shield,
  Swords,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { OutcomeStack } from "@/components/outcome-swatch";
import { PlayerAvatar } from "@/components/player-avatar";
import { ShotRadar } from "@/components/shot-radar";
import { ResultDots } from "@/components/result-dots";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { attentionFor } from "@/lib/analytics/attention";
import { PATTERN_CLASS } from "@/lib/palette";
import { setLastViewedPlayerId } from "@/lib/last-viewed-player";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ColumnChart } from "./column-chart";

// Rally length and shot frequency both need one HTTP call each, and the roster
// can hold any number of players — a card only asks for them once it's
// actually reached, rather than every card firing on mount.
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  return { ref, inView };
}

// Shared between the rally-length and winning-shots charts so their bars start
// from the same baseline and their value/caption rows land at the same height.
const RALLY_BAR_HEIGHT = 96;

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

  // Drive excluded here, not just visually de-emphasised: it dominates nearly
  // every player's mix, and a radar plotting it alongside the other three
  // squashes them toward the centre regardless of the scale chosen. The stat
  // line names the runner-up explicitly, since the radar itself no longer can.
  const nonDriveShotFrequency = (rallyStats?.shot_frequency.you ?? []).filter(
    (point) => point.shot !== "Drive",
  );
  const hasShotFrequency = nonDriveShotFrequency.length > 0;
  const topNonDriveShot =
    nonDriveShotFrequency.length > 0
      ? nonDriveShotFrequency.reduce((best, point) => (point.share > best.share ? point : best))
      : null;

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
              <StatRow icon={CircleCheck} label="1st serve % in" value={`${servedInPercent}%`}>
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
                <OutcomeStack
                  className="mt-1"
                  segments={[
                    { pattern: "forced", weight: forcedCount!, label: "Forced" },
                    { pattern: "unforced", weight: unforcedCount!, label: "Unforced" },
                  ]}
                />
              </StatRow>
            )}
          </div>

          {(rallyStats?.average_rally_length || hasShotFrequency) && (
            <div className="flex gap-3 border-t-2 border-muted-foreground/40 pt-3">
              {rallyStats?.average_rally_length && (
                <div className="flex w-40 shrink-0 flex-col gap-1.5">
                  <div className="flex h-7 items-center gap-1.5">
                    <Ruler className="size-5 shrink-0 text-foreground" aria-hidden="true" />
                    <p className="text-base font-bold text-foreground">Rally length</p>
                  </div>
                  {/* The heading stays pinned at the top, level with Winning
                      shots' own heading — it's the chart that moves, centring
                      in whatever space is left once the taller radar sets the
                      row's height, not the heading chasing it down. */}
                  <div className="flex flex-1 items-center">
                    <ColumnChart
                      ceiling={rallyCeiling}
                      unit=""
                      barZoneHeight={RALLY_BAR_HEIGHT}
                      columns={[
                        {
                          value: rallyStats.average_rally_length.won,
                          caption: "Won",
                          Icon: CircleCheck,
                          pattern: "win",
                        },
                        {
                          value: rallyStats.average_rally_length.lost,
                          caption: "Lost",
                          Icon: CircleX,
                          pattern: "unforced",
                        },
                      ]}
                    />
                  </div>
                </div>
              )}

              {hasShotFrequency && (
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex h-7 items-center gap-1.5">
                    <Zap className="size-5 shrink-0 text-foreground" aria-hidden="true" />
                    <p className="text-base font-bold text-foreground">Winning shots</p>
                  </div>
                  {/* Drive dominates nearly every player's mix (regularly 60%+ of
                      winners), which squashed the other three axes toward the
                      radar's centre where their real differences from each other
                      stopped being visible. Dropping it from the plot — rather
                      than capping the scale, which still fought the same fixed
                      chart geometry — gives Volley/Drop shot/Lob the whole radius
                      to spread across, and the stat line below states plainly
                      what the radar can no longer show on its own. One series
                      only ("yours"), the same single-neutral-colour convention
                      rally-tab.tsx uses for its own single-player view. */}
                  <ShotRadar
                    className="mx-auto aspect-square w-full max-w-56"
                    series={[
                      {
                        name: "Share of point-enders",
                        color: "var(--color-chart-3)",
                        points: nonDriveShotFrequency,
                      },
                    ]}
                  />
                  {topNonDriveShot && (
                    <p className="text-center text-sm font-bold text-foreground">
                      Best beyond Drive: {topNonDriveShot.shot} (
                      {Math.round(topNonDriveShot.share * 100)}%)
                    </p>
                  )}
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
