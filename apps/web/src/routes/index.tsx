import { createFileRoute } from "@tanstack/react-router";

import { SignIn } from "@/features/auth/sign-in";

export const Route = createFileRoute("/")({
  component: SignIn,
});
