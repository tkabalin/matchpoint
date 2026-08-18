import { createFileRoute } from "@tanstack/react-router";

import { StartMatch } from "@/features/matches/start-match";

// A sibling index route rather than a `new-match` layout file: a layout there would
// need its own <Outlet/> and would wrap the $playerId screen too, which it has no
// reason to.
export const Route = createFileRoute("/_authenticated/new-match/")({
  component: StartMatch,
});
