import { BottomNav } from "@/components/bottom-nav";

import { PlayerList } from "./player-list";

export function PlayersPage() {
  return (
    <div>
      <h1>Players</h1>
      <PlayerList />
      <BottomNav />
    </div>
  );
}
