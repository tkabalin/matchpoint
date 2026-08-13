import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/home")({
  component: () => <h1>Welcome to Home</h1>,
});
