import type { PlayerRead } from "@matchpoint/api-client";

import { PhotoAvatar } from "@/components/photo-avatar";

export function PlayerAvatar({
  player,
  size = "lg",
  editable = false,
  className,
}: {
  player: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url">;
  size?: "sm" | "md" | "lg";
  /** Forwarded to PhotoAvatar's camera badge (#192) — only Add/Edit player pass
   * this; roster tiles and action sheets stay read-only. */
  editable?: boolean;
  className?: string;
}) {
  return (
    <PhotoAvatar
      id={player.id}
      initials={`${player.first_name[0]}${player.last_name[0]}`}
      photoUrl={player.photo_url}
      size={size}
      shape="square"
      editable={editable}
      className={className}
    />
  );
}
