import type { MatchRead } from "@matchpoint/api-client";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { InProgressBanner } from "@/components/in-progress-banner";
import { PrimaryMatchAction } from "@/components/primary-match-action";

import { MatchActionSheet } from "./match-action-sheet";
import { MatchList } from "./match-list";

export function MatchesPage() {
  const [selected, setSelected] = useState<MatchRead | null>(null);

  return (
    <AppPage>
      <PageHeader title="Matches" />
      <InProgressBanner />
      <MatchList onSelect={setSelected} />
      <PrimaryMatchAction />

      <MatchActionSheet
        match={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </AppPage>
  );
}
