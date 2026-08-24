import { createFileRoute } from "@tanstack/react-router";

import { NewMatch } from "@/features/matches/new-match";

// Deliberately not nested under players/$playerId — a dot-chained file name there would
// make TanStack Router treat this as a child route requiring PlayerProfile to render an
// <Outlet/>, which single-page-tabs (#157/#158) exists specifically to avoid.
export const Route = createFileRoute("/_authenticated/new-match/$playerId")({
  component: NewMatch,
});
