import type { PlayerRead } from "@matchpoint/api-client";

import { PhotoAvatar } from "@/components/photo-avatar";

export function PlayerAvatar({
  player,
  size = "lg",
  className,
}: {
  player: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <PhotoAvatar
      id={player.id}
      initials={`${player.first_name[0]}${player.last_name[0]}`}
      photoUrl={player.photo_url}
      size={size}
      shape="square"
      className={className}
    />
  );
}
