import { listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { LandPlot } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SURFACE_VALUES } from "@/lib/analytics/filter-options";
import { formatRecord } from "@/lib/format-record";
import { SURFACE_ICON, SURFACE_LABEL } from "@/lib/tennis-labels";

/**
 * A standing win/loss record per surface, sitting beside Recent Form — both
 * are tab-agnostic identity signals, independent of whether the coach is on
 * Serve or Rally (#225). Unlike the scope panel's surface chip, this never
 * moves with the committed filter: it shows every surface at once, so "how
 * do they do on clay" doesn't cost flipping through three surfaces one at a
 * time. Forced:Unforced and 1st serve % per surface come from selecting the
 * scope panel's own surface chip instead, which rescopes the whole tab —
 * duplicating them here would just repeat that.
 *
 * Derived client-side from the match list, which already carries `surface`
 * and `result` per match — the one piece of this axis that doesn't need a
 * new aggregate endpoint (see `match-list.tsx`'s own surface filter for the
 * same client-side precedent).
 */
export function PlayerSurfaceRecordCard({ playerId }: { playerId: string }) {
  const {
    data: matches,
    isPending,
    isError,
  } = useQuery(listMatchesOptions({ query: { player_id: playerId } }));

  if (isPending) return <Skeleton className="h-24 w-full" />;

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load performance by surface.</AlertDescription>
      </Alert>
    );
  }

  const bySurface = SURFACE_VALUES.map((surface) => {
    const played = matches.filter((match) => match.surface === surface && match.result !== null);
    return {
      surface,
      wins: played.filter((match) => match.result === "win").length,
      total: played.length,
    };
  }).filter((row) => row.total > 0);

  // Nothing to show until at least one match carries both a surface and a
  // result — not an error, just a season that hasn't logged either yet.
  if (bySurface.length === 0) return null;

  return (
    <StatCard title="Performance by surface" className="h-full">
      <div className="flex items-center gap-2">
        <LandPlot className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-xs font-semibold text-muted-foreground">Win/loss by surface</span>
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {bySurface.map(({ surface, wins, total }) => {
          const SurfaceIcon = SURFACE_ICON[surface];
          return (
            <div key={surface} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <SurfaceIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {SURFACE_LABEL[surface]}
              </span>
              <span className="tabular-nums">{formatRecord(wins, total - wins)}</span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
}
