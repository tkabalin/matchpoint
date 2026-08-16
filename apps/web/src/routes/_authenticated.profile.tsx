import { createFileRoute } from "@tanstack/react-router";

import { Profile } from "@/features/profile/profile";

export const Route = createFileRoute("/_authenticated/profile")({
  component: Profile,
});
