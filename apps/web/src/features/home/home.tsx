import {
  getCurrentCoachOptions,
  getPlayerOptions,
  listMatchesOptions,
  listPlayersOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { BottomNav } from "@/components/bottom-nav";
import { PlayerAvatar } from "@/components/player-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLastViewedPlayerId, setLastViewedPlayerId } from "@/lib/last-viewed-player";

const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

// `played_on` is a plain calendar date, which `new Date(str)` reads as UTC midnight:
// east of UTC that puts a match played today in the future, dropping it from the count
// until local mid-morning. Both dates are built locally and compared as whole days.
function isWithinTheLastWeek(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const playedOn = new Date(year!, month! - 1, day!);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = Math.round((today.getTime() - playedOn.getTime()) / MILLISECONDS_PER_DAY);
  return daysAgo >= 0 && daysAgo <= 7;
}

export function Home() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const { data: allMatches } = useQuery(listMatchesOptions());
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
      {/* Match-in-progress / resume banner (wireframe 2c) goes here once there's a real
          in-progress-match data source — capture has no route yet (#157). Deliberately
          omitted rather than shown against invented state (#158). */}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Needs attention</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No flagged trends yet.</p>
        </CardContent>
      </Card>
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
          <Link to="/players/$playerId" params={{ playerId: lastViewedPlayer.id }}>
            View full profile
          </Link>
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
            <Link
              key={player.id}
              to="/players/$playerId"
              params={{ playerId: player.id }}
              onClick={() => setLastViewedPlayerId(player.id)}
              className="flex flex-col items-center gap-1"
            >
              <PlayerAvatar player={player} />
              <span>{player.first_name}</span>
            </Link>
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
      <div>
        <h2>Squad snapshot</h2>
        <p>{`Players: ${(players ?? []).length}`}</p>
        <p>
          {`Matches this week: ${(allMatches ?? []).filter((match) => isWithinTheLastWeek(match.played_on)).length}`}
        </p>
      </div>
      <BottomNav />
    </div>
  );
}
