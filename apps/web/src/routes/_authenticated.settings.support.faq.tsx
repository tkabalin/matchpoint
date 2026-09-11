import { createFileRoute } from "@tanstack/react-router";

import { SettingsFaq } from "@/features/settings/settings-faq";

export const Route = createFileRoute("/_authenticated/settings/support/faq")({
  component: SettingsFaq,
});
