import type { MatchRead, MatchSide, PlayerRead, PointRead } from "@matchpoint/api-client";
import { listPointsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, CircleX, Crown, LandPlot, Pencil, Trash2 } from "lucide-react";

import { PhotoAvatar } from "@/components/photo-avatar";
import { PlayerAvatar } from "@/components/player-avatar";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import { initialsFor } from "@/lib/coach-initials";
import { PATTERN_CLASS } from "@/lib/palette";
import { SURFACE_LABEL } from "@/lib/tennis-labels";
import { useInView } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";

import { formatPlayedOn } from "./match-format";

interface MomentumGame {
  gameNumber: number;
  winner: MatchSide;
  isBreak: boolean;
  pointsPlayed: number;
}

interface MomentumSet {
  setNumber: number;
  tracked: number;
  opponent: number;
  winner: MatchSide | null;
  games: MomentumGame[];
}

/** Groups a match's raw point log into completed games, then completed sets —
 * `listPoints` already carries game number, set number, who served, and who
 * won each point, so both the set score and the game-by-game momentum below
 * are derived client-side rather than needing a dedicated backend endpoint.
 * A game with no `is_game_end` point yet (still being played) is dropped
 * rather than guessed at. */
function deriveSets(points: PointRead[]): MomentumSet[] {
  const bySet = new Map<number, Map<number, PointRead[]>>();
  const setEnded = new Set<number>();
  for (const point of points) {
    if (point.is_set_end) setEnded.add(point.set_number);
    let gamesByNumber = bySet.get(point.set_number);
    if (!gamesByNumber) {
      gamesByNumber = new Map();
      bySet.set(point.set_number, gamesByNumber);
    }
    const group = gamesByNumber.get(point.game_number);
    if (group) group.push(point);
    else gamesByNumber.set(point.game_number, [point]);
  }

  return [...bySet.entries()]
    .sort(([a], [b]) => a - b)
    .map(([setNumber, gamesByNumber]) => {
      const games = [...gamesByNumber.entries()]
        .sort(([a], [b]) => a - b)
        .map(([gameNumber, gamePoints]): MomentumGame | null => {
          const ended = gamePoints.find((point) => point.is_game_end);
          if (!ended) return null;
          const winner: MatchSide = ended.won ? "tracked" : "opponent";
          // One player serves the whole game, so any point's `server` will do.
          // A break is the winner not being the side who served it.
          const server = gamePoints[0]!.server;
          return {
            gameNumber,
            winner,
            isBreak: winner !== server,
            pointsPlayed: gamePoints.length,
          };
        })
        .filter((game): game is MomentumGame => game !== null);

      const tracked = games.filter((game) => game.winner === "tracked").length;
      const opponent = games.filter((game) => game.winner === "opponent").length;
      // Comparing games-so-far would call a 1-0 set "won" the moment the first
      // game finishes — only an actual `is_set_end` point (a real completion
      // signal, not a game-count heuristic) earns a winner mark.
      const winner: MatchSide | null = setEnded.has(setNumber)
        ? tracked > opponent
          ? "tracked"
          : "opponent"
        : null;
      return { setNumber, tracked, opponent, winner, games };
    });
}

// A love game (4 points) reads as the most dominant win, drawn as the tallest
// block; a long deuce grind reads as the least, drawn as the shortest. Points
// beyond a dozen still floor out at the minimum rather than shrinking further.
const BLOCK_MAX_HEIGHT = 20;
const BLOCK_MIN_HEIGHT = 8;
const BLOCK_MIN_POINTS = 4;
const BLOCK_MAX_POINTS = 12;

function blockHeight(pointsPlayed: number): number {
  const clamped = Math.min(Math.max(pointsPlayed, BLOCK_MIN_POINTS), BLOCK_MAX_POINTS);
  const span = BLOCK_MAX_POINTS - BLOCK_MIN_POINTS;
  return (
    BLOCK_MAX_HEIGHT - ((clamped - BLOCK_MIN_POINTS) / span) * (BLOCK_MAX_HEIGHT - BLOCK_MIN_HEIGHT)
  );
}

/** An initials-only avatar for our own tracked player on the rare roster
 * desync where their id no longer resolves. Never used for the opponent —
 * `opponent_name` is free text with no linked player row, so there's no photo
 * to ever fall back from, and giving them an avatar box the same as our
 * player's own would visually imply a capability that doesn't exist. */
function NameAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <PhotoAvatar
      id={name}
      initials={initialsFor(name)}
      photoUrl={null}
      size="sm"
      shape="square"
      className={className}
    />
  );
}

/** The match-winner crown, reserving its slot either way so the two names'
 * columns line up whether or not this side actually won. Uses the same
 * win-outcome green a set's own tick already carries, rather than inventing a
 * "trophy gold" the color palette has no role for. */
function WinnerCrown({ won }: { won: boolean }) {
  if (!won) {
    return <Crown className="mx-auto block size-4 text-outcome-win opacity-0" aria-hidden="true" />;
  }
  return (
    <Crown className="mx-auto block size-4 text-outcome-win" role="img" aria-label="Match winner" />
  );
}

function playerName(player: Pick<PlayerRead, "first_name" | "last_name">): string {
  return `${player.first_name} ${player.last_name}`;
}

export function MatchCard({
  match,
  player,
  onEdit,
  onDelete,
}: {
  match: MatchRead;
  // Absent means the roster fetch hasn't resolved this player yet, or the id
  // no longer matches anyone on the roster — either way, a name-only avatar
  // and "Unknown player" beats silently dropping the row.
  player: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url"> | undefined;
  // Both absent is the player's own matches list (#203): a player can't edit or
  // delete a match, so the whole actions column disappears rather than rendering
  // disabled buttons nobody can use.
  onEdit?: (match: MatchRead) => void;
  onDelete?: (match: MatchRead) => void;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const opponentName = match.opponent_name ?? "Unknown opponent";
  const ourName = player ? playerName(player) : "Unknown player";

  const { data: points } = useQuery({
    ...listPointsOptions({ path: { match_id: match.id } }),
    enabled: inView,
  });
  const sets = points ? deriveSets(points) : [];

  return (
    // The row and the edit/delete buttons are siblings, not nested — a button
    // inside an anchor is invalid HTML, and an earlier overlay-link version of
    // this turned out unreliable for real clicks despite passing in tests.
    <div ref={ref} className="flex items-stretch gap-1">
      <Item
        variant="outline"
        render={<Link to="/matches/$matchId" params={{ matchId: match.id }} />}
        // `Item`'s own base class is a flex row (`item.tsx`), and this is the
        // one shape that trips a real mobile WebKit bug: a single full-width
        // flex-col child, several layers above the sets strip's own
        // `overflow-x-auto`. Relying on that div alone to establish "auto min
        // size → 0" up the whole chain holds on desktop Chromium/Firefox but
        // not reliably on iOS Safari — min-w-0 has to be explicit at every
        // level between here and there, not just where the scrolling happens.
        className="w-full min-w-0 flex-1 text-left"
      >
        <div className="flex w-full min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {player ? <PlayerAvatar player={player} size="md" /> : <NameAvatar name={ourName} />}
              <div className="min-w-0 flex-1">
                <WinnerCrown won={match.result === "win"} />
                <p className="truncate text-center text-sm font-bold text-foreground">{ourName}</p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-bold text-muted-foreground">vs</span>
            {/* No avatar on this side, deliberately: `opponent_name` is free
                text with no linked player row, so there's never a real photo
                behind it — giving it an avatar box the same as our own
                player's would imply a capability that doesn't exist. */}
            <div className="min-w-0 flex-1">
              <WinnerCrown won={match.result === "loss"} />
              <p className="truncate text-center text-sm font-bold text-foreground">
                {opponentName}
              </p>
            </div>
          </div>

          {match.result === null && (
            <p className="text-center text-xs font-semibold text-muted-foreground">
              Not finished yet — no winner
            </p>
          )}

          <div className="flex items-start gap-3">
            {sets.length > 0 && (
              // Each set is one column — its score sits directly above its own
              // momentum group rather than two separately-centred rows, which
              // only stayed aligned by accident (a score's text width and its
              // momentum group's width rarely match, so two independent
              // `justify-center` rows drift apart as more sets are added).
              // `min-w-0` lets this flex-1 child actually shrink below its
              // content's width so `overflow-x-auto` can do its job instead of
              // forcing the whole card wider once sets stop fitting.
              <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto">
                {sets.map((set, index) => (
                  <div
                    key={set.setNumber}
                    className={cn(
                      "flex shrink-0 flex-col items-center gap-1.5",
                      index > 0 && "border-l border-muted-foreground/30 pl-3",
                    )}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-sm font-bold text-foreground tabular-nums">
                        {set.tracked}–{set.opponent}
                      </span>
                      {set.winner === "tracked" && (
                        <CircleCheck
                          className="size-4 text-outcome-win"
                          role="img"
                          aria-label={`Won set ${set.setNumber}`}
                        />
                      )}
                      {set.winner === "opponent" && (
                        <CircleX
                          className="size-4 text-outcome-unforced"
                          role="img"
                          aria-label={`Lost set ${set.setNumber}`}
                        />
                      )}
                    </div>
                    <div className="flex items-end gap-0.5">
                      {set.games.map((game) => (
                        <div key={game.gameNumber} className="flex flex-col items-center">
                          <span
                            className={cn(
                              "mb-0.5 size-1 rounded-full bg-foreground",
                              game.isBreak ? "opacity-100" : "opacity-0",
                            )}
                            aria-hidden="true"
                          />
                          <div
                            className={cn(
                              "w-1.5 rounded-t-sm",
                              game.winner === "tracked"
                                ? PATTERN_CLASS.win
                                : PATTERN_CLASS.unforced,
                            )}
                            style={{ height: blockHeight(game.pointsPlayed) }}
                            aria-hidden="true"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              className={cn(
                "flex shrink-0 items-start gap-1",
                sets.length === 0 && "flex-1 justify-end",
              )}
            >
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-sm font-semibold text-muted-foreground">
                  {formatPlayedOn(match.played_on)}
                </span>
                {match.surface && (
                  <span className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
                    <LandPlot className="size-4 shrink-0" aria-hidden="true" />
                    {SURFACE_LABEL[match.surface]}
                  </span>
                )}
              </div>
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </Item>
      {/* Edit pinned to the top and delete to the bottom (`justify-between`
          across the full stretched height) rather than stacked together in
          the middle — the card grew tall enough that adjacent icon buttons
          read as a matched pair, raising the odds of hitting the wrong one.
          Edit stays blue (the app's reserved interactive/brand color), delete
          stays red (the same destructive tone every other delete control in
          the app uses). Offered on a completed match too: finishing one
          freezes only its result and scoring system (#228), and the sheet
          locks that one field itself rather than the row hiding the whole
          control. */}
      {(onEdit ?? onDelete) && (
        <div className="flex flex-col justify-between py-2 pr-1">
          {onEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-primary"
              aria-label={`Edit details for the match vs ${opponentName}`}
              onClick={() => onEdit(match)}
            >
              <Pencil />
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive"
              aria-label={`Delete the match vs ${opponentName}`}
              onClick={() => onDelete(match)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
