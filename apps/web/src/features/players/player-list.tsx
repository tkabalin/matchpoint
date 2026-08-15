import { listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { setLastViewedPlayerId } from "@/lib/last-viewed-player";

/**
 * The roster, read through the generated client.
 *
 * Deliberately plain: this is the first call over the codegen pipeline and exists to
 * pin the pattern — `listPlayersOptions()` from the generated query module, passed
 * straight to `useQuery`, with the response type coming from the API's own schema.
 */
export function PlayerList() {
  const { data, isPending, isError } = useQuery(listPlayersOptions());

  if (isPending) return <p>Loading players…</p>;
  if (isError) return <p role="alert">Could not load players.</p>;
  if (data.length === 0) return <p>No players yet.</p>;

  return (
    <ul>
      {data.map((player) => (
        <li key={player.id}>
          <Link
            to="/players/$playerId"
            params={{ playerId: player.id }}
            onClick={() => setLastViewedPlayerId(player.id)}
          >
            {player.first_name} {player.last_name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
