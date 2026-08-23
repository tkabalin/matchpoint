import type { PlayerRead } from "@matchpoint/api-client";

import { StatCard } from "@/components/stat-card";

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

/** Date of birth, dominant hand and the player's own notes field — real
 *  `PlayerRead` data that lost its only view surface when the Overview tab
 *  was removed; write-only via the edit sheet isn't good enough for a coach
 *  who just wants to check it. */
export function PlayerDetailsCard({ player }: { player: PlayerRead }) {
  return (
    <StatCard title="Player details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Date of birth</dt>
        <dd>{player.date_of_birth ? formatDateOfBirth(player.date_of_birth) : "—"}</dd>
        <dt className="text-muted-foreground">Dominant hand</dt>
        <dd className="capitalize">{player.dominant_hand ?? "—"}</dd>
        <dt className="text-muted-foreground">Notes</dt>
        <dd>{player.notes ?? "—"}</dd>
      </dl>
    </StatCard>
  );
}
