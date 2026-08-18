import type { PlayerRead } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";

import { PlayerAvatar } from "@/components/player-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { setLastViewedPlayerId } from "@/lib/last-viewed-player";
import { cn } from "@/lib/utils";

/**
 * The two things a coach does with a player, offered wherever one is tapped
 * (roster, home screen). Tapping a player goes here rather than straight to the
 * profile because starting a match is the courtside action and shouldn't cost an
 * extra screen to reach.
 */
export function PlayerActionSheet({
  player,
  open,
  onOpenChange,
}: {
  player: Pick<PlayerRead, "id" | "first_name" | "last_name"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!player) return null;

  const playerName = `${player.first_name} ${player.last_name}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="flex-row items-center gap-3 p-0">
          <PlayerAvatar player={player} />
          <SheetTitle>{playerName}</SheetTitle>
        </SheetHeader>

        {/* Styled `Link`s rather than `Button render={<Link/>}`: Base UI's
            `nativeButton={false}` stamps `role="button"` onto the anchor, which
            hides from assistive tech that these navigate. */}
        <Link
          to="/players/$playerId"
          params={{ playerId: player.id }}
          onClick={() => setLastViewedPlayerId(player.id)}
          className={cn(buttonVariants(), "w-full")}
        >
          View player
        </Link>
        <Link
          to="/new-match/$playerId"
          params={{ playerId: player.id }}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          Start match
        </Link>
        <SheetClose render={<Button variant="ghost" className="w-full text-muted-foreground" />}>
          Cancel
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
