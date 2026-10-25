import { createFileRoute } from "@tanstack/react-router";

import { PlayerSettingsApp } from "@/features/players/player-settings-app";

export const Route = createFileRoute("/_player/me_/settings/app")({
  component: PlayerSettingsApp,
});
