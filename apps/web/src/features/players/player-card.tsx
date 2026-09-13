import type { BreakdownRow, PlayerRead, ShotShare, SquadMemberStats } from "@matchpoint/api-client";
import { getRallyStatsOptions, getServeStatsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Flag,
  Rainbow,
  Ruler,
  Shield,
  Swords,
  TrendingUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BreakdownBars } from "@/components/breakdown-bars";
import { OutcomeStack } from "@/components/outcome-swatch";
import { PlayerAvatar } from "@/components/player-avatar";
import { ResultDots } from "@/components/result-dots";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { attentionFor } from "@/lib/analytics/attention";
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

const SHOT_ICON: Record<string, typeof TrendingUp> = {
  Drive: TrendingUp,
  Volley: ChevronUp,
  "Drop shot": ChevronDown,
  Lob: Rainbow,
};

function favouriteAndLeast(shares: ShotShare[]): [ShotShare, ShotShare] | null {
  if (shares.length === 0) return null;
  const sorted = [...shares].sort((a, b) => b.share - a.share);
  return [sorted[0]!, sorted[sorted.length - 1]!];
}

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

  const servedInRow: BreakdownRow | null = serveStats?.serving.outcome.first_serve
    ? {
        label: "Serves into play",
        value:
          serveStats.serving.outcome.first_serve.landed +
          serveStats.serving.outcome.first_serve.ace,
        max: 100,
      }
    : null;
  const returnPercent = serveStats ? returnInPercent(serveStats.returning.breakdown) : null;
  const returnedInRow: BreakdownRow | null =
    returnPercent === null ? null : { label: "Returns into play", value: returnPercent, max: 100 };

  const forcedUnforcedWeights = rallyStats?.outcome_mix.find((row) => row.label === "You");
  const heroValue = rallyStats?.hero
    ? (rallyStats.hero.display ?? rallyStats.hero.value.toFixed(2))
    : null;

  const rallyCeiling = rallyStats
    ? Math.max(
        rallyStats.average_rally_length.won ?? 0,
        rallyStats.average_rally_length.lost ?? 0,
        1,
      )
    : 1;

  const youShots = rallyStats ? favouriteAndLeast(rallyStats.shot_frequency.you) : null;
  const againstShots = rallyStats ? favouriteAndLeast(rallyStats.shot_frequency.opponents) : null;
  const showShotChart = youShots !== null || againstShots !== null;

  return (
    <Card ref={ref} className="overflow-hidden py-0">
      <Link
        to="/players/$playerId"
        params={{ playerId: player.id }}
        onClick={() => setLastViewedPlayerId(player.id)}
        // Distinguishes this link's accessible name from the in-progress banner's
        // (`in-progress-banner.tsx`), which is titled with the same bare player
        // name whenever this player's match is the one left open — the roster
        // and the banner can otherwise show identical text at the same time.
        aria-label={`View ${playerName}'s profile`}
        className="flex items-center gap-3 p-4"
      >
        <PlayerAvatar player={player} size="md" />
        <div className="flex-1">
          <p className="flex items-center gap-2 font-bold">
            {playerName}
            {/* Non-interactive — the whole header is already a link, so a live
                transfer code is a badge here, not a control. #185 owns
                cancelling it, from the player's profile. */}
            {player.has_transfer_code && <Badge variant="secondary">Transfer pending</Badge>}
          </p>
          {flag && <p className="text-xs text-outcome-unforced">{flag}</p>}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>

      {hasLoggedMatches && member && (
        <CardContent className="flex flex-col gap-3 pb-4">
          <ResultDots results={member.last5_results} />

          <div className="flex flex-col gap-2.5 border-t pt-3">
            <p className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
              All matches
            </p>

            {servedInRow && (
              <BreakdownBars rows={[servedInRow]} pattern="indigo" icon={() => Flag} unit="%" />
            )}
            {returnedInRow && (
              <BreakdownBars rows={[returnedInRow]} pattern="indigo" icon={() => Shield} unit="%" />
            )}

            {heroValue && forcedUnforcedWeights && (
              <div className="flex items-center gap-2.5">
                <Swords className="size-6 shrink-0 text-foreground" aria-hidden="true" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs">
                    <span>Forced : Unforced</span>
                    <span className="tabular-nums">{heroValue}</span>
                  </div>
                  <OutcomeStack
                    className="mt-1"
                    segments={[
                      { pattern: "forced", weight: forcedUnforcedWeights.forced, label: "Forced" },
                      {
                        pattern: "unforced",
                        weight: forcedUnforcedWeights.unforced,
                        label: "Unforced",
                      },
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          {(rallyStats?.average_rally_length || showShotChart) && (
            <div className="flex gap-3 border-t pt-3">
              {rallyStats?.average_rally_length && (
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Ruler className="size-4 shrink-0 text-foreground" aria-hidden="true" />
                    <p className="text-xs font-semibold text-muted-foreground">Rally length</p>
                  </div>
                  <ColumnChart
                    title=""
                    ceiling={rallyCeiling}
                    unit=""
                    columns={[
                      {
                        value: rallyStats.average_rally_length.won,
                        caption: "Won",
                        pattern: "win",
                      },
                      {
                        value: rallyStats.average_rally_length.lost,
                        caption: "Lost",
                        pattern: "unforced",
                      },
                    ]}
                  />
                </div>
              )}

              {showShotChart && (
                <div className="flex flex-1 flex-col gap-1">
                  <p className="text-xs font-semibold text-muted-foreground">Winning shots</p>
                  <ColumnChart
                    title=""
                    ceiling={1}
                    unit="%"
                    columns={[
                      {
                        value: youShots ? Math.round(youShots[0].share * 100) : null,
                        caption: youShots?.[0].shot ?? "",
                        Icon: youShots ? SHOT_ICON[youShots[0].shot] : undefined,
                        pattern: "yellow",
                      },
                      {
                        value: youShots ? Math.round(youShots[1].share * 100) : null,
                        caption: youShots?.[1].shot ?? "",
                        Icon: youShots ? SHOT_ICON[youShots[1].shot] : undefined,
                        pattern: "yellow",
                      },
                      {
                        value: againstShots ? Math.round(againstShots[0].share * 100) : null,
                        caption: againstShots?.[0].shot ?? "",
                        Icon: againstShots ? SHOT_ICON[againstShots[0].shot] : undefined,
                        pattern: "violet",
                      },
                      {
                        value: againstShots ? Math.round(againstShots[1].share * 100) : null,
                        caption: againstShots?.[1].shot ?? "",
                        Icon: againstShots ? SHOT_ICON[againstShots[1].shot] : undefined,
                        pattern: "violet",
                      },
                    ]}
                  />
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
          View stats
        </Link>
        <Link
          to="/new-match/$playerId"
          params={{ playerId: player.id }}
          className={cn(buttonVariants(), "flex-1 rounded-none border-0 border-l")}
        >
          Start match
        </Link>
      </div>
    </Card>
  );
}
