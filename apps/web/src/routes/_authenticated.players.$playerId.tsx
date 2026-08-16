import { createFileRoute } from "@tanstack/react-router";

import { PlayerProfile } from "@/features/players/player-profile";

export const Route = createFileRoute("/_authenticated/players/$playerId")({
  component: PlayerProfile,
});
