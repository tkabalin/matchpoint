import { createFileRoute } from "@tanstack/react-router";

import { Home } from "@/features/home/home";

export const Route = createFileRoute("/home")({
  component: Home,
});
