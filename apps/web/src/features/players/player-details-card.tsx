import type { PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { IdCard, Pencil } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";

// `date_of_birth` is a plain calendar date; `new Date(str)` reads it as UTC
// midnight, which is the previous day east of UTC (.claude/rules/web.md).
function formatDateOfBirth(dateOfBirth: string): string {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Date of birth, dominant hand and the player's own notes field — real
 * `PlayerRead` data that lost its only view surface when the Overview tab was
 * removed; write-only via the edit sheet isn't good enough for a coach who
 * just wants to check it. Owns the Edit trigger too, now that it sits in the
 * one card whose whole content that button edits.
 *
 * Also mounted on a player's own view of themselves (#203), reading the
 * trimmer `PlayerSelfRead` the player-auth endpoints return — no `notes`
 * there (coach notes are deliberately private) and no edit action (editing a
 * player is coach-only), so both are omitted rather than shown broken.
 */
export function PlayerDetailsCard({
  player,
  onEdit,
}: {
  player: PlayerRead | PlayerSelfRead;
  onEdit?: () => void;
}) {
  return (
    <StatCard className="h-full">
      <div className="flex items-center gap-2">
        <IdCard className="size-7 shrink-0 text-primary" aria-hidden="true" />
        <p className="flex-1 text-base font-bold text-foreground">Player details</p>
        {onEdit && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit" onClick={onEdit}>
            <Pencil />
          </Button>
        )}
      </div>
      {/* Stacked, not side by side — this card sits at half page width now
          (next to the win/loss card), and a label-left/value-right row has
          no room to breathe at that width. */}
      <dl className="flex flex-col gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd>{player.date_of_birth ? formatDateOfBirth(player.date_of_birth) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Dominant hand</dt>
          <dd className="capitalize">{player.dominant_hand ?? "—"}</dd>
        </div>
        {"notes" in player && (
          <div>
            <dt className="text-muted-foreground">Notes</dt>
            {/* `dd` collapses newlines by default — a note written line by
                line in the edit sheet's textarea has to keep reading that
                way here. */}
            <dd className="whitespace-pre-line">{player.notes ?? "—"}</dd>
          </div>
        )}
      </dl>
    </StatCard>
  );
}
