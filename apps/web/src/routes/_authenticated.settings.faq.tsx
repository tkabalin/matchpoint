import { createFileRoute } from "@tanstack/react-router";

import { SettingsFaq } from "@/features/settings/settings-faq";

export const Route = createFileRoute("/_authenticated/settings/faq")({
  component: SettingsFaq,
});
