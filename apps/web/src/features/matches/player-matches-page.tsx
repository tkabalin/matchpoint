import { PLAYER_TABS } from "@/components/nav-tabs";
import { AppPage, PageHeader } from "@/components/page-shell";

import { PlayerMatchList } from "./player-match-list";

export function PlayerMatchesPage() {
  return (
    <AppPage tabs={PLAYER_TABS}>
      <PageHeader title="Matches" />
      <PlayerMatchList />
    </AppPage>
  );
}
