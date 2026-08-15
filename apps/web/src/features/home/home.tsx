import {
  getCurrentCoachOptions,
  getPlayerOptions,
  listMatchesOptions,
  listPlayersOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { PlayerAvatar } from "@/components/player-avatar";
import { getLastViewedPlayerId } from "@/lib/last-viewed-player";

export function Home() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const [search, setSearch] = useState("");

  const lastViewedPlayerId = getLastViewedPlayerId();
  const { data: lastViewedPlayer } = useQuery({
    ...getPlayerOptions({ path: { player_id: lastViewedPlayerId ?? "" } }),
    enabled: lastViewedPlayerId !== null,
  });
  const { data: lastViewedMatches } = useQuery({
    ...listMatchesOptions({ query: { player_id: lastViewedPlayerId ?? "" } }),
    enabled: lastViewedPlayerId !== null,
  });

  const searchResults = (players ?? []).filter((player) =>
    `${player.first_name} ${player.last_name}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="flex justify-between">
        <Link to="/profile">Profile</Link>
        <Link to="/settings">Settings</Link>
      </div>
      {coach && (
        <div>
          <p>Welcome back</p>
          <p>{`Coach ${coach.display_name}`}</p>
        </div>
      )}
      <h1>Welcome to Home</h1>
      {lastViewedPlayer && lastViewedMatches && (
        <div>
          <h2>Last viewed player</h2>
          <div className="flex items-center gap-2">
            <PlayerAvatar player={lastViewedPlayer} />
            <span>
              {lastViewedPlayer.first_name} {lastViewedPlayer.last_name}
            </span>
          </div>
          <p>{`Matches: ${lastViewedMatches.length}`}</p>
          {/* Not a real link yet — the player profile route lands in a later issue. */}
          <button type="button">View full profile</button>
        </div>
      )}
      <label htmlFor="player-search">Search players</label>
      <input
        id="player-search"
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {search !== "" && (
        <ul>
          {searchResults.length === 0 && <li>No players found.</li>}
          {searchResults.map((player) => (
            <li key={player.id}>
              {player.first_name} {player.last_name}
            </li>
          ))}
        </ul>
      )}
      <div>
        <div className="flex justify-between">
          <h2>My Players</h2>
          <Link to="/players">See all</Link>
        </div>
        <div className="flex gap-4 overflow-x-auto">
          {(players ?? []).map((player) => (
            <div key={player.id} className="flex flex-col items-center gap-1">
              <PlayerAvatar player={player} />
              <span>{player.first_name}</span>
            </div>
          ))}
          <Link to="/players" className="flex flex-col items-center gap-1">
            <div
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-dashed"
            >
              +
            </div>
            <span>Add</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
