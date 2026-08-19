import { Camera } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

// A small fixed palette, picked deterministically from the owner's id — no per-owner
// color picker, just enough to tell initials-only avatars apart at a glance. The six
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
  // The Profile hero band's avatar (#179) — nothing else needs it yet.
  xl: "size-24 text-2xl",
} as const;

function colorFor(id: string): string {
  const sum = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
  // Non-null: the index is a modulo of the (fixed, non-empty) palette's own length.
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}

/**
 * A photo when one is set, otherwise initials on a deterministic color — the shared
 * rendering both `PlayerAvatar` and the coach's Profile avatar sit on top of. Split out
 * once there were two real owners of "show this person's picture, or their initials if
 * they have none" (players and coaches), per `.claude/rules/web.md`.
 */
export function PhotoAvatar({
  id,
  initials,
  photoUrl,
  size = "lg",
  shape = "square",
  editable = false,
  className,
}: {
  id: string;
  initials: string;
  photoUrl?: string | null;
  size?: keyof typeof AVATAR_SIZE;
  /** Square roster chips (players) vs. the circular convention for a person's own
   * profile photo (Jakob's Law — every mainstream account settings page uses one). */
  shape?: "square" | "circle";
  /** Overlays the standard camera badge (Jakob's Law — WhatsApp, LinkedIn, iOS
   * Settings all use one) so a tappable avatar reads as tappable. Purely a
   * signifier: the caller's own button is still the tap target, so this only
   * belongs where that's true — Profile's own photo, not a read-only roster tile. */
  editable?: boolean;
  className?: string;
}) {
  // A stored photo_url is immutable-cached and never reused for different bytes (#191),
  // so a broken image means the file is gone, not stale — falling back to initials
  // rather than retrying is the correct response either way.
  const [broken, setBroken] = useState(false);
  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-sm";

  const avatar =
    photoUrl && !broken ? (
      <img
        src={photoUrl}
        alt=""
        onError={() => setBroken(true)}
        className={cn(
          "swatch-halo shrink-0 object-cover",
          shapeClass,
          AVATAR_SIZE[size],
          className,
        )}
      />
    ) : (
      <div
        aria-hidden="true"
        // Carries the palette's dual-ring halo but not its pattern: the initials are
        // already the non-color channel the pattern rule exists to provide, and a
        // pattern behind two letters costs more legibility than it buys.
        className={cn(
          "swatch-halo flex shrink-0 items-center justify-center font-bold",
          shapeClass,
          AVATAR_SIZE[size],
          DARK_TEXT_COLORS.has(colorFor(id)) ? "text-black" : "text-white",
          className,
        )}
        style={{ backgroundColor: colorFor(id) }}
      >
        {initials}
      </div>
    );

  if (!editable) return avatar;

  return (
    <div className="relative inline-block">
      {avatar}
      <span
        aria-hidden="true"
        className="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground"
      >
        <Camera className="size-3.5" />
      </span>
    </div>
  );
}
