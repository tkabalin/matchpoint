import { createFileRoute } from "@tanstack/react-router";

import { PlayerSettingsAccount } from "@/features/players/player-settings-account";

export const Route = createFileRoute("/_player/me_/settings/account")({
  component: PlayerSettingsAccount,
});
