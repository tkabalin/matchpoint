import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";

import { getRecentFormOptions, listOpponentsOptions } from "@/lib/analytics/analytics-options";
import { cn } from "@/lib/utils";

/**
 * The dot row above the Serve/Rally tabs — tab-agnostic, and the one piece of
 * this screen that actually responds to the applied scope: it's keyed by the
 * committed opponent, not by set/phase (see `stats-scope-panel.tsx`'s own doc
 * comment on why those two don't vary anything yet).
 */
export function RecentFormRow({
  playerId,
  opponentId,
}: {
  playerId: string;
  opponentId: string | null;
}) {
  const { data } = useQuery(
    getRecentFormOptions({ path: { player_id: playerId }, query: { opponentId } }),
  );
  const { data: opponents } = useQuery(listOpponentsOptions({ path: { player_id: playerId } }));
  if (!data) return null;

  const opponentName = opponents?.find((opponent) => opponent.id === opponentId)?.name ?? null;

  const wins = data.results.filter((result) => result === "win").length;
  const losses = data.results.length - wins;
  const label = `Recent form · last ${data.results.length}${opponentName ? ` vs ${opponentName}` : ""}`;

  return (
    <div className="flex items-center gap-3 rounded-sm border bg-card px-3.5 py-2.5">
      <Activity className="size-6 shrink-0 text-primary" aria-hidden="true" />
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-1 gap-1">
        {data.results.map((result, index) => (
          <span
            key={index}
            role="img"
            aria-label={result === "win" ? "Won" : "Lost"}
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              result === "win" ? "bg-outcome-win" : "border border-muted-foreground",
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums">
        {wins}W – {losses}L
      </span>
    </div>
  );
}
