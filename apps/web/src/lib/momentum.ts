import type { MatchSide, PointRead } from "@matchpoint/api-client";

export interface MomentumGame {
  gameNumber: number;
  winner: MatchSide;
  isBreak: boolean;
  pointsPlayed: number;
  /** Every coach note captured during this game, oldest first. Empty when none were. */
  notes: string[];
  /** Share of this game's bucketed points that ran past 5 shots (buckets b3/b4),
   *  0 to 100. Null when this game recorded no rally-length bucket at all, so a
   *  genuine 0% (every point short) is never confused with "nothing captured". */
  longRallyShare: number | null;
}

export interface MomentumSet {
  setNumber: number;
  tracked: number;
  opponent: number;
  winner: MatchSide | null;
  games: MomentumGame[];
}

const LONG_RALLY_BUCKETS = new Set(["b3", "b4"]);

/** Groups a match's raw point log into completed games, then completed sets.
 * `listPoints` already carries game number, set number, who served, who won
 * each point, any note attached to it, and its rally-length bucket, so
 * `match-card.tsx`'s small momentum strip, `momentum-card.tsx`'s blown-up
 * one, and `rally-intensity-chart.tsx`'s per-game rally read all derive
 * everything client-side rather than needing a dedicated backend endpoint.
 * A game with no `is_game_end` point yet (still being played) is dropped
 * rather than guessed at. Moved out of `features/matches/` into `lib/` once
 * a component outside that slice (`rally-tab.tsx`, in `components/`) needed
 * it too, per the "shared code belongs in lib/, not a feature slice" rule.
 *
 * `matchFinished` overrides a missing `is_set_end` flag for the *last* set
 * only: a real gap has shown up where a match had a definitive final result
 * (`match.result`) but its own last set carried no end-of-set point, which
 * otherwise read as "still in progress", an impossible state for a match
 * that's actually over, and left that set floating with no winner mark, at
 * a different height to its neighbours (their score block reserves room for
 * an icon that never renders). Every set *before* the last one is trusted
 * regardless: the match couldn't have moved on to the next set otherwise. */
export function deriveSets(points: PointRead[], matchFinished: boolean): MomentumSet[] {
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

  const setNumbers = [...bySet.keys()].sort((a, b) => a - b);

  return setNumbers.map((setNumber, index) => {
    const gamesByNumber = bySet.get(setNumber)!;
    const games = [...gamesByNumber.entries()]
      .sort(([a], [b]) => a - b)
      .map(([gameNumber, gamePoints]): MomentumGame | null => {
        const ended = gamePoints.find((point) => point.is_game_end);
        if (!ended) return null;
        const winner: MatchSide = ended.won ? "tracked" : "opponent";
        // One player serves the whole game, so any point's `server` will do.
        // A break is the winner not being the side who served it.
        const server = gamePoints[0]!.server;
        const notes = gamePoints
          .filter((point) => point.note !== null)
          .sort((a, b) => a.sequence - b.sequence)
          .map((point) => point.note!);
        const bucketed = gamePoints.filter((point) => point.rally_length_bucket !== null);
        const long = bucketed.filter((point) =>
          LONG_RALLY_BUCKETS.has(point.rally_length_bucket!),
        ).length;
        const longRallyShare =
          bucketed.length === 0 ? null : Math.round((100 * long) / bucketed.length);
        return {
          gameNumber,
          winner,
          isBreak: winner !== server,
          pointsPlayed: gamePoints.length,
          notes,
          longRallyShare,
        };
      })
      .filter((game): game is MomentumGame => game !== null);

    const tracked = games.filter((game) => game.winner === "tracked").length;
    const opponent = games.filter((game) => game.winner === "opponent").length;
    const isLastSet = index === setNumbers.length - 1;
    // Comparing games-so-far would call a 1-0 set "won" the moment the first
    // game finishes, so only an actual `is_set_end` point (a real completion
    // signal, not a game-count heuristic) earns a winner mark, unless this is
    // the last set of a match that's definitively over.
    const ended = setEnded.has(setNumber) || !isLastSet || matchFinished;
    const winner: MatchSide | null = ended ? (tracked > opponent ? "tracked" : "opponent") : null;

    return { setNumber, tracked, opponent, winner, games };
  });
}

// A love game (4 points) reads as the most dominant win, drawn as the tallest
// block; a long deuce grind reads as the least, drawn as the shortest. Points
// beyond a dozen still floor out at the minimum rather than shrinking further.
export const BLOCK_MAX_HEIGHT = 20;
export const BLOCK_MIN_HEIGHT = 8;
export const BLOCK_MIN_POINTS = 4;
export const BLOCK_MAX_POINTS = 12;

/** `maxHeight`/`minHeight` default to the small strip's own scale
 *  (`match-card.tsx`); the blown-up card (`momentum-card.tsx`) passes its own
 *  larger pair so the same point-count-to-height curve just draws bigger. */
export function blockHeight(
  pointsPlayed: number,
  maxHeight: number = BLOCK_MAX_HEIGHT,
  minHeight: number = BLOCK_MIN_HEIGHT,
): number {
  const clamped = Math.min(Math.max(pointsPlayed, BLOCK_MIN_POINTS), BLOCK_MAX_POINTS);
  const span = BLOCK_MAX_POINTS - BLOCK_MIN_POINTS;
  return maxHeight - ((clamped - BLOCK_MIN_POINTS) / span) * (maxHeight - minHeight);
}

// The break-dot's own reserved space (a size-1 dot plus its mb-0.5 gap) above
// the tallest possible bar, this is the games-row's own fixed height, not an
// auto one. Left to size itself to its own tallest bar, a set whose longest
// game happened to run a few points shorter than another set's would get a
// shorter row overall, and since both rows are top-aligned (a set-group
// column, not this row, is what shares a top edge with its neighbours), that
// shorter row's *bottom*, its baseline, would sit measurably higher than
// the other sets' (found against real seeded data: an 18.5px row next to a
// 20px one). Every set's games-row now commits to the same fixed height
// regardless of its own contents, which is what actually guarantees a shared
// baseline, not just a shared top.
export const GAMES_ROW_HEIGHT = BLOCK_MAX_HEIGHT + 6;
