import {
  getCurrentCoachOptions,
  getPlayerOptions,
  listOpponentsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";

import { PlayerLoadError } from "@/components/player-load-error";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveMatch } from "@/features/capture/live-match";
import { getRecordedOwner } from "@/lib/local-data";

import { useCaptureClaim } from "./capture-claim";
import { CaptureTakeoverSheet } from "./capture-takeover-sheet";

// Avoids a circular import between this component and its route file — same pattern as
// player-profile.tsx.
const routeApi = getRouteApi("/_authenticated/new-match/$playerId");

/**
 * The bridge between routing and capture: everything a live match needs from the
 * network, fetched once here, because `features/capture/` may not import the API client
 * at all (see .claude/rules/web-capture.md). Past this point capture is on its own and
 * works with the device offline.
 *
 * Not an `AppPage`: capture fills the viewport rather than scrolling in a column, and
 * the in-progress banner that shell carries would be advertising the very match being
 * captured underneath it.
 */
export function NewMatch() {
  const { playerId } = routeApi.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const {
    data: player,
    isError,
    error,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));
  // Read where it arrives, never waited for: the coach carries nothing but the setup
  // screen's defaults, and blocking on /coaches/me is what stranded a coach who reached
  // the court offline with no cached copy of it.
  const { data: coach } = useQuery(getCurrentCoachOptions());
  // Same "read where it arrives, never waited for" reasoning as coach above: the
  // setup screen's suggestions are a nicety, not something worth a spinner over, and
  // an empty array (no cached list, or genuinely no prior opponents) reads to it as
  // "nothing to suggest" rather than an error.
  const { data: opponents } = useQuery(listOpponentsOptions({ path: { player_id: playerId } }));
  // Whose device this is, off localStorage rather than the wire, and the same id the
  // sync layer drains the outbox under (flush-triggers.ts) — so a match queued here is
  // queued under the id that will send it.
  const coachId = getRecordedOwner();

  // Called unconditionally, ahead of the early returns below, per the rules of hooks —
  // an empty id before the coach/player are known simply matches no in-progress match,
  // so the claim stays idle until there's something real to claim.
  const claim = useCaptureClaim({ coachId: coachId ?? "", trackedPlayerId: player?.id ?? "" });

  function goBack() {
    // Reachable from Home and from the Players tab's own card now, so a
    // fixed destination would send half of those visits somewhere they
    // didn't come from — same reasoning as `player-profile.tsx`'s back
    // button. Pops real browser history, falling back to Home only for
    // a direct/deep link with nothing to pop.
    if (router.history.canGoBack()) {
      router.history.back();
    } else {
      void navigate({ to: "/home" });
    }
  }

  // Without this the flow offers to start a match for a player the coach cannot reach
  // — the 404 has to stop it rather than leave a blank (#78).
  if (isError)
    return (
      <div className="mx-auto max-w-sm p-4">
        <PlayerLoadError error={error} />
      </div>
    );

  // No owner means no sign-in has ever completed here, so every row capture queued
  // would carry a coach the drain cannot run for. Rare enough to be a sentence rather
  // than a screen, and never worth starting a match nothing can send.
  if (coachId === null) {
    return (
      <div className="mx-auto max-w-sm p-4 text-sm text-muted-foreground">
        This device has no coach recorded yet. Sign in once with a connection before starting a
        match here.
      </div>
    );
  }

  if (player === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Deleted from another device (#214) — stop rendering capture at all, which is
  // what stops further points being queued against a match that no longer exists.
  if (claim.gone) {
    return (
      <div className="mx-auto max-w-sm p-4">
        <Empty role="alert">
          <EmptyHeader>
            <EmptyTitle>This match was deleted</EmptyTitle>
            <EmptyDescription>
              It was deleted from another device. Nothing more will be sent for it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={goBack}>Back</Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  // Completed from another device — the claim's own 409 already told us so.
  if (claim.finishedElsewhere) {
    return (
      <div className="mx-auto max-w-sm p-4">
        <Empty role="alert">
          <EmptyHeader>
            <EmptyTitle>This match is already finished</EmptyTitle>
            <EmptyDescription>It was completed on another device.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                if (claim.matchId !== null) {
                  void navigate({ to: "/matches/$matchId", params: { matchId: claim.matchId } });
                }
              }}
            >
              View results
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-5 pt-4 pb-8">
      <LiveMatch
        coachId={coachId}
        trackedPlayerId={player.id}
        playerName={player.first_name}
        // Null is a coach who saved no default; undefined is what lets the setup
        // screen's own fall back. The API's ScoringSystem and capture's are the same
        // members and have to stay that way for this to pass straight through.
        defaultScoringSystem={coach?.default_scoring_system ?? undefined}
        defaultSurfaceType={coach?.default_surface ?? undefined}
        previousOpponents={(opponents ?? []).map((opponent) => opponent.name)}
        onExit={goBack}
        onGoHome={() => {
          void navigate({ to: "/home" });
        }}
        onViewResults={(matchId) => {
          void navigate({ to: "/matches/$matchId", params: { matchId } });
        }}
      />
      <CaptureTakeoverSheet
        open={claim.conflict}
        takingOver={claim.takingOver}
        error={claim.takeoverError}
        onTakeOver={claim.takeOver}
        onDecline={() => {
          claim.declineTakeover();
          goBack();
        }}
      />
    </div>
  );
}
