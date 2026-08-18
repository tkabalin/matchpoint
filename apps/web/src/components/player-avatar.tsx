import type { PlayerRead } from "@matchpoint/api-client";

import { cn } from "@/lib/utils";

// A small fixed palette, picked deterministically from the player's id — no images,
// no per-player color picker, just enough to tell bubbles apart at a glance. The six
// non-blue steps of the categorical palette in .claude/rules/web-color.md — blue is
// nav/brand-exclusive there, so it's excluded here rather than reused as a category
// color.
const AVATAR_COLORS = ["#9C3D0A", "#E69F00", "#EDDD6E", "#1FBF8C", "#2E1A47", "#D9569E"];

// Pale yellow is the one light enough that white initials wash out on it.
const DARK_TEXT_COLORS = new Set(["#EDDD6E"]);

const AVATAR_SIZE = {
  sm: "size-7 text-[0.625rem]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

function colorFor(id: string): string {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
  // Non-null: the index is a modulo of the (fixed, non-empty) palette's own length.
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

export function PlayerAvatar({
  player,
  size = "lg",
  className,
}: {
  player: Pick<PlayerRead, "id" | "first_name" | "last_name">;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  const initials = `${player.first_name[0]}${player.last_name[0]}`;
  const color = colorFor(player.id);

  return (
    <div
      aria-hidden="true"
      // Carries the palette's dual-ring halo but not its pattern: the initials are
      // already the non-color channel the pattern rule exists to provide, and a
      // pattern behind two letters costs more legibility than it buys.
      className={cn(
        "swatch-halo flex shrink-0 items-center justify-center rounded-sm font-bold",
        AVATAR_SIZE[size],
        DARK_TEXT_COLORS.has(color) ? "text-black" : "text-white",
        className,
      )}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}
