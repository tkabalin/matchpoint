import { getCurrentCoachOptions, getPlayerOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import { PlayerLoadError } from "@/components/player-load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveMatch } from "@/features/capture/live-match";

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
  const {
    data: player,
    isError,
    error,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));
  const { data: coach } = useQuery(getCurrentCoachOptions());

  // Without this the flow offers to start a match for a player the coach cannot reach
  // — the 404 has to stop it rather than leave a blank (#78).
  if (isError)
    return (
      <div className="mx-auto max-w-sm p-4">
        <PlayerLoadError error={error} />
      </div>
    );

  if (player === undefined || coach === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col px-5 pt-4 pb-8">
      <LiveMatch
        coachId={coach.id}
        trackedPlayerId={player.id}
        playerName={player.first_name}
        onExit={() => {
          void navigate({ to: "/home" });
        }}
        onViewResults={(matchId) => {
          void navigate({ to: "/matches/$matchId", params: { matchId } });
        }}
      />
    </div>
  );
}
