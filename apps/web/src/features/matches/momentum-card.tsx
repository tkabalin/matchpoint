import { listPointsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Info, Waves } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { blockHeight, deriveSets } from "@/lib/momentum";
import { PATTERN_CLASS } from "@/lib/palette";
import { cn } from "@/lib/utils";

// A bigger scale than `match-card.tsx`'s own strip (20/8), but the columns
// themselves stay tight and packed close together, so a typical multi-set
// match's full game count fits without horizontal scrolling on a
// phone-width screen.
const BLOCK_MAX_HEIGHT = 28;
const BLOCK_MIN_HEIGHT = 10;
// The bar itself, plus reserved space above it for the break-dot (always
// mounted, opacity-toggled) — every game's column commits to this same
// total height regardless of its own contents, same reasoning as
// `momentum.ts`'s own `GAMES_ROW_HEIGHT` comment.
const GAMES_ROW_HEIGHT = BLOCK_MAX_HEIGHT + 10;

/**
 * The full-size momentum chart for a single match's stats page (#294 follow-up):
 * the same set-by-set, game-by-game read `match-card.tsx` shows small on the
 * Matches list, blown up as its own card, plus the coach notes captured live
 * during the match.
 *
 * Notes sit in a plain list below the chart rather than behind a per-game
 * toggle: with the bars packed this tightly, a tap target sized to one game's
 * own column would be too small and too easy to miss the game next to it.
 * Each note is labelled by exactly where it was captured (set and game) and
 * nothing else, oldest first within a game and games in play order, since
 * that's the one fact a coach actually needs to place it back in the match.
 */
export function MomentumCard({
  matchId,
  matchFinished,
}: {
  matchId: string;
  matchFinished: boolean;
}) {
  const {
    data: points,
    isPending,
    isError,
  } = useQuery(listPointsOptions({ path: { match_id: matchId } }));

  if (isPending) return <Skeleton className="h-48 w-full" />;

  if (isError) {
    return (
      <StatCard title="Momentum">
        <p className="text-xs text-muted-foreground">Could not load this match's momentum.</p>
      </StatCard>
    );
  }

  const sets = deriveSets(points, matchFinished);
  const allNotes = sets.flatMap((set) =>
    set.games.flatMap((game) =>
      game.notes.map((note, index) => ({
        key: `${set.setNumber}:${game.gameNumber}:${index}`,
        setNumber: set.setNumber,
        gameNumber: game.gameNumber,
        note,
      })),
    ),
  );

  return (
    <StatCard>
      <div className="flex items-center gap-3">
        <Waves className="size-9 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <div className="flex items-center gap-1">
            <p className="text-base font-bold">Momentum</p>
            {/* Tap-triggered, not hover — same touch-first reasoning as the
                home screen's own squad-stat explainers. */}
            <Popover>
              <PopoverTrigger
                render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" />}
                aria-label="Explain momentum"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent className="w-64 text-sm" side="bottom">
                One bar per completed game, in play order. Its colour is who won the game, and its
                height is how few points that took: a love game is the tallest, a long deuce game
                the shortest. A dot above the bar marks a break of serve.
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-xs text-muted-foreground">
            Bar height indicates level of dominance from the winner of that game
          </p>
        </div>
      </div>

      {sets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No points recorded for this match yet.</p>
      ) : (
        <>
          <div className="flex min-w-0 items-start gap-1 overflow-x-auto pt-1">
            {sets.map((set, index) => (
              <div
                key={set.setNumber}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-2",
                  index > 0 && "border-l border-muted-foreground/30 pl-1",
                )}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xl font-extrabold text-foreground tabular-nums">
                    {set.tracked}–{set.opponent}
                  </span>
                  {/* Always mounted, opacity-toggled — same reserve-the-slot
                      reasoning as `match-card.tsx`'s own winner mark. */}
                  {set.winner === "tracked" ? (
                    <CircleCheck
                      className="size-6 text-outcome-win"
                      role="img"
                      aria-label={`Won set ${set.setNumber}`}
                    />
                  ) : set.winner === "opponent" ? (
                    <CircleX
                      className="size-6 text-outcome-unforced"
                      role="img"
                      aria-label={`Lost set ${set.setNumber}`}
                    />
                  ) : (
                    <CircleX className="size-6 opacity-0" aria-hidden="true" />
                  )}
                </div>

                <div className="flex items-end gap-0.5" style={{ height: GAMES_ROW_HEIGHT }}>
                  {set.games.map((game) => (
                    <div key={game.gameNumber} className="flex flex-col items-center">
                      <span
                        className={cn(
                          "mb-1 size-1.5 rounded-full bg-foreground",
                          game.isBreak ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <div
                        className={cn(
                          "w-2 rounded-t-sm",
                          game.winner === "tracked" ? PATTERN_CLASS.win : PATTERN_CLASS.unforced,
                        )}
                        style={{
                          height: blockHeight(
                            game.pointsPlayed,
                            BLOCK_MAX_HEIGHT,
                            BLOCK_MIN_HEIGHT,
                          ),
                        }}
                        aria-hidden="true"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-foreground" aria-hidden="true" />
            Break of serve
          </p>

          {allNotes.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-sm border bg-muted/30 p-3 text-xs text-muted-foreground">
              {allNotes.map(({ key, setNumber, gameNumber, note }) => (
                <li key={key}>
                  <span className="font-bold text-foreground">
                    Set {setNumber}, Game {gameNumber}:
                  </span>{" "}
                  {note}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </StatCard>
  );
}
