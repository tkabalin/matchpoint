import type { PlayerRead } from "@matchpoint/api-client";
import { ListOrdered } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ChipRow } from "@/components/chip-row";
import { ForcedUnforcedBalance } from "@/components/forced-unforced-balance";
import { PlayerAvatar } from "@/components/player-avatar";
import { StatCard } from "@/components/stat-card";
import { Input } from "@/components/ui/input";
import { Item } from "@/components/ui/item";
import {
  METRIC_ICON,
  METRIC_LABEL,
  METRIC_PATTERN,
  buildLeaderboard,
  metricDisplay,
} from "@/lib/analytics/squad-stats";
import type { SquadMetricKey, SquadStatsEntry } from "@/lib/analytics/types.provisional";
import { PATTERN_CLASS } from "@/lib/palette";
import { cn } from "@/lib/utils";

const METRIC_OPTIONS: { value: SquadMetricKey; label: string; icon: LucideIcon }[] = (
  Object.entries(METRIC_LABEL) as [SquadMetricKey, string][]
).map(([value, label]) => ({ value, label, icon: METRIC_ICON[value] }));

type NamedEntry = SquadStatsEntry & { name: string };

/** The row's own magnitude visual: a 0–100 fill bar for the two percentage
 *  metrics (win % and first-serve %), or the same levelling-tool needle the
 *  player card uses for forced:unforced — a bare ratio can't show a balance
 *  between two counts the way a needle position can. */
function LeaderboardVisual({
  metric,
  value,
  entry,
}: {
  metric: SquadMetricKey;
  value: number | null;
  entry: SquadStatsEntry;
}) {
  if (metric === "forcedToUnforced") {
    return <ForcedUnforcedBalance forced={entry.forcedCount} unforced={entry.unforcedCount} />;
  }
  const pattern = METRIC_PATTERN[metric];
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-sm bg-muted">
      {value !== null && (
        <div
          className={cn("h-full", PATTERN_CLASS[pattern])}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}

export function SquadLeaderboardCard({
  entries,
  players,
  metric,
  onMetricChange,
  search,
  onSearchChange,
}: {
  entries: NamedEntry[];
  /** Full roster, only for the avatar next to each row — the ranking/metric
   *  logic itself stays player-identity-free in `squad-stats.ts`. */
  players: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url">[];
  metric: SquadMetricKey;
  onMetricChange: (metric: SquadMetricKey) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) {
  const rows = buildLeaderboard(entries, metric, search);
  const entryByPlayerId = new Map(entries.map((entry) => [entry.playerId, entry]));
  const playerById = new Map(players.map((player) => [player.id, player]));

  return (
    <StatCard>
      <div className="flex items-center gap-2">
        <ListOrdered className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold text-foreground">Leaderboard</h3>
      </div>

      <ChipRow<SquadMetricKey>
        aria-label="Leaderboard metric"
        options={METRIC_OPTIONS}
        value={metric}
        onChange={onMetricChange}
        scroll
      />

      <Input
        aria-label="Search players"
        placeholder="Search players"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <div className="flex max-h-[320px] touch-pan-y touch-pinch-zoom flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {rows.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">No players match.</p>
        ) : (
          rows.map((row) => {
            const entry = entryByPlayerId.get(row.playerId)!;
            const player = playerById.get(row.playerId);
            const valueText =
              metric === "forcedToUnforced"
                ? `${entry.forcedCount} | ${entry.unforcedCount}`
                : metricDisplay(entry, metric);
            return (
              <Item
                key={row.playerId}
                variant="outline"
                size="sm"
                className="flex-col items-stretch"
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-xs font-bold text-muted-foreground">
                    {row.rank}
                  </span>
                  {player && <PlayerAvatar player={player} size="sm" />}
                  <span className="flex-1 truncate text-sm font-bold text-foreground">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                    {valueText}
                  </span>
                </div>
                <LeaderboardVisual metric={metric} value={row.metricValue} entry={entry} />
              </Item>
            );
          })
        )}
      </div>
    </StatCard>
  );
}
