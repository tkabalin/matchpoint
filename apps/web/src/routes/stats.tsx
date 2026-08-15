import { createFileRoute } from "@tanstack/react-router";

import { StatsPage } from "@/features/stats/stats-page";

export const Route = createFileRoute("/stats")({
  component: StatsPage,
});
