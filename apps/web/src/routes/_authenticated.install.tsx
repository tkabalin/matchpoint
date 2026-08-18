import { createFileRoute } from "@tanstack/react-router";

import { InstallGuide } from "@/features/pwa/install-guide";

export const Route = createFileRoute("/_authenticated/install")({
  component: InstallGuide,
});
