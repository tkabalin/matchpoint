import { createFileRoute } from "@tanstack/react-router";

import { PlayerProfile } from "@/features/players/player-profile";

export const Route = createFileRoute("/players/$playerId")({
  component: PlayerProfile,
});
