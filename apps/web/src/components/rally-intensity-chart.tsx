import { listPointsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Ruler } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { deriveSets } from "@/lib/momentum";
import { cn } from "@/lib/utils";

// A fixed pixel zone, not a CSS percentage of an auto-height ancestor (the
// known pitfall `.claude/rules/web-stat-cards.md` calls out): each bar's own
// height is computed in pixels against this one constant. Kept narrow and
// short, with tight gaps below, so a typical multi-set match's full game
// count fits without horizontal scrolling on a phone-width screen.
const BAR_ZONE_HEIGHT = 72;
const BAR_WIDTH = 10;

/**
 * "In-match momentum": how rally intensity actually swung game by game within
 * one match, replacing the trend hypnogram's own single, near-meaningless bar
 * once `RallyTab` is scoped to a single match (a real trend needs several
 * matches, not one). The Y axis is the share of that game's own bucketed
 * points that ran past 5 shots, not a mean shot count, so a love game full of
 * aces and a deuce-heavy grind read as dramatically different bar heights
 * instead of both collapsing toward the same "3-5 shots" average.
 *
 * Derived entirely client-side from the same `listPoints` read `MomentumCard`
 * already fetches for this match (`PointRead.rally_length_bucket` is already
 * on every point), so no backend change was needed here, unlike the
 * player-level hypnogram's own trend metric (blocked on #296).
 *
 * Games are numbered continuously across the whole match (G1, G2, G3, ...)
 * rather than restarting at each set, with a set boundary marked by a plain
 * vertical divider, the same idiom `momentum-card.tsx` and `match-card.tsx`
 * already use for grouping by set.
 *
 * Color-blind accessible by construction, not just by color: a won game's
 * bar is a flat, fully solid fill, and a lost game's bar carries the same
 * high-contrast diagonal stripe (`pattern-unforced`) the rest of the app
 * already uses for a loss, so the two remain distinguishable in grayscale on
 * a single isolated bar, with no adjacent bar of the other color needed for
 * comparison.
 */
export function RallyIntensityChart({ matchId }: { matchId: string }) {
  const {
    data: points,
    isPending,
    isError,
  } = useQuery(listPointsOptions({ path: { match_id: matchId } }));

  if (isPending) return <Skeleton className="h-56 w-full" />;

  if (isError) {
    return (
      <StatCard title="Rally intensity">
        <p className="text-xs text-muted-foreground">
          Could not load this match's rally intensity.
        </p>
      </StatCard>
    );
  }

  // A per-set winner isn't read by this chart at all, only each game's own
  // winner, so `matchFinished` (which only ever affects a set's own summary
  // winner) makes no difference to anything rendered here.
  const sets = deriveSets(points, false);
  // Numbered once, up front, rather than inside the JSX below: games count
  // continuously across the whole match (G1, G2, G3, ...) instead of
  // restarting at each set, so each set's own starting number is however
  // many games came before it, in every earlier set combined.
  const gamesBeforeSet = sets.map((_, setIndex) =>
    sets.slice(0, setIndex).reduce((sum, set) => sum + set.games.length, 0),
  );
  const numberedSets = sets.map((set, setIndex) => ({
    setNumber: set.setNumber,
    games: set.games.map((game, gameIndex) => ({
      ...game,
      label: `G${gamesBeforeSet[setIndex]! + gameIndex + 1}`,
    })),
  }));

  return (
    <StatCard>
      <div className="flex items-center gap-3">
        <Ruler className="size-9 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-base font-bold">Rally intensity, game by game</p>
          <p className="text-xs text-muted-foreground">
            Share of that game's points running past 5 shots
          </p>
        </div>
      </div>

      {sets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No points recorded for this match yet.</p>
      ) : (
        <>
          <div className="flex min-w-0 gap-2">
            <div
              className="flex shrink-0 flex-col justify-between text-right text-[0.625rem] font-semibold text-muted-foreground"
              style={{ height: BAR_ZONE_HEIGHT }}
              aria-hidden="true"
            >
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>

            <div className="flex min-w-0 flex-1 items-end gap-2 overflow-x-auto pl-1">
              {numberedSets.map((set, setIndex) => (
                <div
                  key={set.setNumber}
                  className={cn(
                    "flex shrink-0 items-end gap-1",
                    setIndex > 0 && "border-l border-muted-foreground/30 pl-2",
                  )}
                >
                  {set.games.map((game) => {
                    const { label } = game;
                    const hasData = game.longRallyShare !== null;
                    const barHeight = hasData
                      ? Math.max(2, (game.longRallyShare! / 100) * BAR_ZONE_HEIGHT)
                      : 2;
                    return (
                      <div key={game.gameNumber} className="flex flex-col items-center gap-1">
                        <div
                          className="flex items-end"
                          style={{ height: BAR_ZONE_HEIGHT, width: BAR_WIDTH }}
                        >
                          <div
                            className={cn(
                              "w-full rounded-t-sm",
                              hasData
                                ? game.winner === "tracked"
                                  ? "bg-outcome-win"
                                  : "pattern-unforced"
                                : "bg-muted-foreground/30",
                            )}
                            style={{ height: barHeight }}
                            role="img"
                            aria-label={
                              hasData
                                ? `${label}, ${game.winner === "tracked" ? "won" : "lost"}, ${game.longRallyShare}% of points past 5 shots`
                                : `${label}, no rally length recorded`
                            }
                          />
                        </div>
                        <span className="text-[0.625rem] font-semibold text-muted-foreground">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="swatch-halo size-2.5 shrink-0 rounded-[2px] bg-outcome-win"
              />
              Won game
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="swatch-halo size-2.5 shrink-0 rounded-[2px] pattern-unforced"
              />
              Lost game
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
