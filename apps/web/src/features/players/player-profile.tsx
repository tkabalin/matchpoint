import { getPlayerOptions, listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";

import { PlayerAvatar } from "@/components/player-avatar";

// Avoids a circular import between this component and its route file — the
// standard TanStack Router way to read typed params from outside the route file.
const routeApi = getRouteApi("/_authenticated/players/$playerId");

export function PlayerProfile() {
  const { playerId } = routeApi.useParams();
  const {
    data: player,
    isPending,
    isError,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));
  const { data: matches } = useQuery(listMatchesOptions({ query: { player_id: playerId } }));

  if (isPending) return <p>Loading player…</p>;
  if (isError) return <p role="alert">Could not load that player.</p>;

  return (
    <div>
      <Link to="/home">← Home</Link>
      <div className="flex items-center gap-2">
        <PlayerAvatar player={player} />
        <h1>{`${player.first_name} ${player.last_name}`}</h1>
      </div>
      <dl>
        <dt>Date of birth</dt>
        <dd>{player.date_of_birth ?? "—"}</dd>
        <dt>Dominant hand</dt>
        <dd>{player.dominant_hand ?? "—"}</dd>
        <dt>Notes</dt>
        <dd>{player.notes ?? "—"}</dd>
      </dl>
      <p>{`Matches: ${matches?.length ?? "…"}`}</p>
    </div>
  );
}
