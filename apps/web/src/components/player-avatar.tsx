import type { PlayerRead } from "@matchpoint/api-client";

// A small fixed palette, picked deterministically from the player's id — no images,
// no per-player color picker, just enough to tell bubbles apart at a glance.
const AVATAR_COLORS = ["#045C8C", "#2E1A47", "#C13584", "#009E73", "#D55E00"];

function colorFor(id: string): string {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
  // Non-null: the index is a modulo of the (fixed, non-empty) palette's own length.
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

export function PlayerAvatar({
  player,
}: {
  player: Pick<PlayerRead, "id" | "first_name" | "last_name">;
}) {
  const initials = `${player.first_name[0]}${player.last_name[0]}`;

  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-lg text-white"
      style={{ backgroundColor: colorFor(player.id) }}
    >
      {initials}
    </div>
  );
}
