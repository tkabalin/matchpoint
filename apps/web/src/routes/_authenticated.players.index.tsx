import { createFileRoute } from "@tanstack/react-router";

import { PlayersPage } from "@/features/players/players-page";

// An index route rather than `players.tsx`: a route file at that path becomes the
// parent of `players.$playerId`, so the roster would have to render an <Outlet /> and
// the profile would appear underneath it instead of replacing it.
export const Route = createFileRoute("/_authenticated/players/")({
  component: PlayersPage,
});
