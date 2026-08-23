import { createFileRoute } from "@tanstack/react-router";

import { MatchesPage } from "@/features/matches/matches-page";

// An index route rather than `matches.tsx`: a route file at that path becomes the
// parent of `matches.$matchId`, so the list would have to render an <Outlet /> and the
// per-match stats page would appear underneath it instead of replacing it — same
// reasoning as `_authenticated.players.index.tsx`.
export const Route = createFileRoute("/_authenticated/matches/")({
  component: MatchesPage,
});
