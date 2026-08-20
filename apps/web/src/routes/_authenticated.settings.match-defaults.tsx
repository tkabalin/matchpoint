import { createFileRoute } from "@tanstack/react-router";

import { SettingsMatchDefaults } from "@/features/settings/settings-match-defaults";

export const Route = createFileRoute("/_authenticated/settings/match-defaults")({
  component: SettingsMatchDefaults,
});
