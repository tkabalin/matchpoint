import { createFileRoute } from "@tanstack/react-router";

import { PlayerSettingsSupport } from "@/features/players/player-settings-support";

export const Route = createFileRoute("/_player/me_/settings/support")({
  component: PlayerSettingsSupport,
});
