import { createFileRoute } from "@tanstack/react-router";

import { SettingsApp } from "@/features/settings/settings-app";

export const Route = createFileRoute("/_authenticated/settings/app")({
  component: SettingsApp,
});
