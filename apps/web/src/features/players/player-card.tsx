import type { BreakdownRow, PlayerRead, ShotShare, SquadMemberStats } from "@matchpoint/api-client";
import { getRallyStatsOptions, getServeStatsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Flag,
  Rainbow,
  Ruler,
  Shield,
  Swords,
  TrendingUp,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BreakdownBars } from "@/components/breakdown-bars";
import { OutcomeLegend, OutcomeStack } from "@/components/outcome-swatch";
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

// Shared between the rally-length and winning-shots charts so their bars start
// from the same baseline and their value/caption rows land at the same height.
const RALLY_BAR_HEIGHT = 96;

const SHOT_ICON: Record<string, typeof TrendingUp> = {
  Drive: TrendingUp,
  Volley: ChevronUp,
  "Drop shot": ChevronDown,
  Lob: Rainbow,
};

function favourite(shares: ShotShare[]): ShotShare | null {
  if (shares.length === 0) return null;
  return shares.reduce((best, share) => (share.share > best.share ? share : best));
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

  const youFavourite = rallyStats ? favourite(rallyStats.shot_frequency.you) : null;
  const againstFavourite = rallyStats ? favourite(rallyStats.shot_frequency.opponents) : null;
  const showShotChart = youFavourite !== null || againstFavourite !== null;

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
          <p className="flex items-center gap-2 font-bold">
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

            {hasForcedUnforced && (
              <div className="flex items-center gap-2.5">
                <Swords className="size-6 shrink-0 text-foreground" aria-hidden="true" />
                <div className="flex-1">
                  <div className="flex justify-between text-xs">
                    <span>Forced : Unforced</span>
                    <span className="tabular-nums">
                      {forcedCount} | {unforcedCount}
                    </span>
                  </div>
                  <OutcomeStack
                    className="mt-1"
                    segments={[
                      { pattern: "forced", weight: forcedCount!, label: "Forced" },
                      { pattern: "unforced", weight: unforcedCount!, label: "Unforced" },
                    ]}
                  />
                </div>
              </div>
            )}
          </div>

          {(rallyStats?.average_rally_length || showShotChart) && (
            <div className="flex gap-3 border-t pt-3">
              {rallyStats?.average_rally_length && (
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Ruler className="size-5 shrink-0 text-foreground" aria-hidden="true" />
                    <p className="text-base font-bold text-foreground">Rally length</p>
                  </div>
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
              )}

              {showShotChart && (
                <div className="flex flex-1 flex-col gap-1.5">
                  {/* Heading and key share one row — the same height as rally
                      length's icon+heading row — so both charts' bars start at
                      the same line rather than the key adding a row of its own
                      above them. Key above the bars, not below: the two
                      columns' colour is read the instant the chart is seen.
                      Just the favourite per side — the profile's own shot
                      radar (rally-tab.tsx) has the full breakdown; this is a
                      summary, not a duplicate of it. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-bold text-foreground">Winning shots</p>
                    <OutcomeLegend
                      items={[
                        { pattern: "yellow", label: "Yours" },
                        { pattern: "violet", label: "Opponent's" },
                      ]}
                    />
                  </div>
                  <ColumnChart
                    ceiling={100}
                    unit="%"
                    barZoneHeight={RALLY_BAR_HEIGHT}
                    columns={[
                      {
                        value: youFavourite ? Math.round(youFavourite.share * 100) : null,
                        caption: youFavourite?.shot ?? "",
                        Icon: youFavourite ? SHOT_ICON[youFavourite.shot] : undefined,
                        pattern: "yellow",
                      },
                      {
                        value: againstFavourite ? Math.round(againstFavourite.share * 100) : null,
                        caption: againstFavourite?.shot ?? "",
                        Icon: againstFavourite ? SHOT_ICON[againstFavourite.shot] : undefined,
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
