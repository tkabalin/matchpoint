import { getCurrentCoachOptions, listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

export function Home() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const [search, setSearch] = useState("");

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
    </div>
  );
}
