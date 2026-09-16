import { createFileRoute } from "@tanstack/react-router";

import { PlayerSettings } from "@/features/players/player-settings";

export const Route = createFileRoute("/_player/me_/settings")({
  component: PlayerSettings,
});
