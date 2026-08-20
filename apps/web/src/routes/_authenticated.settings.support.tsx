import { createFileRoute } from "@tanstack/react-router";

import { SettingsSupport } from "@/features/settings/settings-support";

export const Route = createFileRoute("/_authenticated/settings/support")({
  component: SettingsSupport,
});
