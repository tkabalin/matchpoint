import { AppPage, PageHeader } from "@/components/page-shell";
import { InProgressBanner } from "@/components/in-progress-banner";
import { PrimaryMatchAction } from "@/components/primary-match-action";

import { MatchList } from "./match-list";

export function MatchesPage() {
  return (
    <AppPage>
      <PageHeader title="Matches" />
      <InProgressBanner />
      <MatchList />
      <PrimaryMatchAction />
    </AppPage>
  );
}
