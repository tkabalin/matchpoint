/**
 * The boundary between the capture domain model and the API for a score checkpoint —
 * the sibling of point-payload.ts. Unlike a point, a checkpoint's own stored snapshot
 * (`checkpoint.ts`'s `ScoreSnapshot`) carries no `winner` and no notion of which sets
 * are complete: that is derived by `score.ts`'s `interpretSnapshot`, the same function
 * the score editor itself calls to validate what the coach typed. This mapper leans on
 * the same derivation rather than re-deriving it.
 *
 * Needs the match, not just the checkpoint, because `interpretSnapshot` and
 * `serverRoleOf` (turning a set's winning player id into the wire's tracked/opponent)
 * both do. Enum-lowering is enum-case.ts's `lower`, shared with point-payload.ts.
 */

import type { ScoreCheckpointCreate, ScoreSnapshotSet } from "@matchpoint/api-client";

import type { ScoreCheckpoint } from "@/features/capture/checkpoint";
import type { Match } from "@/features/capture/match";
import type { Server } from "@/features/capture/point";
import { interpretSnapshot, serverRoleOf } from "@/features/capture/score";

import { lower } from "./enum-case";

function winnerOf(match: Match, winner: string | null): Lowercase<Server> | null {
  return winner === null ? null : lower(serverRoleOf(match, winner));
}

export function toScoreCheckpointCreate(
  match: Match,
  checkpoint: ScoreCheckpoint,
): ScoreCheckpointCreate {
  const read = interpretSnapshot(match, checkpoint.after);
  if ("problems" in read) {
    throw new Error(
      `checkpoint snapshot does not interpret against its match: ${read.problems
        .map((problem) => problem.message)
        .join("; ")}`,
    );
  }
  const { board } = read;

  // completedSets plus, when the match isn't decided, the set in progress: the same
  // pairing `snapshotOf` (score.ts) builds `checkpoint.after` from in the first place.
  const sets: ScoreSnapshotSet[] = board.completedSets.map((entry) => ({
    set_number: entry.set.setNumber,
    games_tracked: entry.set.trackedPlayerGames,
    games_opponent: entry.set.opponentGames,
    tiebreak_tracked: entry.set.tiebreak?.trackedPlayerPoints ?? null,
    tiebreak_opponent: entry.set.tiebreak?.opponentPoints ?? null,
    winner: winnerOf(match, entry.set.winner),
  }));
  if (board.currentSet !== null) {
    const live = board.currentSet;
    sets.push({
      set_number: live.setNumber,
      games_tracked: live.trackedGames,
      games_opponent: live.opponentGames,
      tiebreak_tracked: live.tiebreak?.tracked ?? null,
      tiebreak_opponent: live.tiebreak?.opponent ?? null,
      winner: null,
    });
  }

  return {
    id: checkpoint.id,
    sequence: checkpoint.sequence,
    serves_next: lower(checkpoint.servesNext),
    order_changed: checkpoint.orderChanged,
    after: { sets },
  };
}
