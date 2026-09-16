import { listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, LandPlot } from "lucide-react";
import { useEffect, useState } from "react";

import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SURFACE_VALUES } from "@/lib/analytics/filter-options";
import { SURFACE_ICON, SURFACE_LABEL, SURFACE_PATTERN_CLASS } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

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
 *
 * Each surface's panel is textured in the real court colour a coach sees
 * mid-match (`pattern-surface-*` in app.css, the same colours `live-match.tsx`
 * paints the capture screen with) rather than an abstract stand-in, with a
 * simplified white court-line diagram drawn on top so it reads as an actual
 * court, not just a swatch. A solid white block masks down from the top of
 * each panel — animated in on mount, so the court visibly grows into view
 * rather than snapping straight to its final state — its height the loss
 * share, so the court itself (colour, texture and lines together) is what
 * grows with the win rate and "cuts through" the record rather than sitting
 * beside it. The exact win/loss count still stands above each panel in the
 * same tick/cross icons the rest of the app uses, since a visual proportion
 * alone can't carry the precise numbers, and the icon/label underneath is
 * what tells two panels apart without relying on colour alone.
 */
function CourtLines() {
  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <rect
        x="0.75"
        y="0.75"
        width="198.5"
        height="98.5"
        fill="none"
        stroke="white"
        strokeWidth="1.5"
        strokeOpacity="0.85"
      />
      {/* Singles sidelines, inset from the doubles ones above — the band
          outside them, top and bottom, is the doubles alley. */}
      <line x1="0" y1="12" x2="200" y2="12" stroke="white" strokeWidth="1.2" strokeOpacity="0.8" />
      <line x1="0" y1="88" x2="200" y2="88" stroke="white" strokeWidth="1.2" strokeOpacity="0.8" />
      {/* The net, spanning the full doubles width. */}
      <line
        x1="100"
        y1="0"
        x2="100"
        y2="100"
        stroke="white"
        strokeWidth="1.2"
        strokeOpacity="0.8"
      />
      {/* The two service lines, each set back from the net, plus the centre
          service line between them splitting the deuce/ad boxes. */}
      <line x1="46" y1="12" x2="46" y2="88" stroke="white" strokeWidth="1.2" strokeOpacity="0.8" />
      <line
        x1="154"
        y1="12"
        x2="154"
        y2="88"
        stroke="white"
        strokeWidth="1.2"
        strokeOpacity="0.8"
      />
      <line x1="46" y1="50" x2="154" y2="50" stroke="white" strokeWidth="1.2" strokeOpacity="0.8" />
      {/* Centre marks, a short tick at each baseline's own midpoint. */}
      <line x1="0" y1="50" x2="4" y2="50" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" />
      <line
        x1="196"
        y1="50"
        x2="200"
        y2="50"
        stroke="white"
        strokeWidth="1.5"
        strokeOpacity="0.85"
      />
    </svg>
  );
}
export function PlayerSurfaceRecordCard({ playerId }: { playerId: string }) {
  const {
    data: matches,
    isPending,
    isError,
  } = useQuery(listMatchesOptions({ query: { player_id: playerId } }));

  // Starts fully masked and reveals a tick after mount, so the CSS transition
  // on the mask below actually has a "from" state to animate away from —
  // setting it straight to its final height on the very first render leaves
  // nothing for the transition to run between.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (isPending) return <Skeleton className="h-40 w-full" />;

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
      {/* Inline `gridTemplateColumns`, not a `grid-cols-*` class: a player with
          matches on only one or two surfaces still fills the row rather than
          leaving empty trailing columns a fixed 4-column grid would. */}
      <div
        className="mt-1 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${bySurface.length}, minmax(0, 1fr))` }}
      >
        {bySurface.map(({ surface, wins, total }) => {
          const SurfaceIcon = SURFACE_ICON[surface];
          const losses = total - wins;
          const winRate = (wins / total) * 100;
          return (
            <div key={surface} className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1.5 text-base font-bold tabular-nums">
                <span className="flex items-center gap-0.5 text-outcome-win">
                  <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
                  {wins}
                </span>
                <span className="flex items-center gap-0.5 text-outcome-unforced">
                  <CircleX className="size-5 shrink-0" aria-hidden="true" />
                  {losses}
                </span>
              </div>
              <div
                className={cn(
                  "swatch-halo relative h-24 w-full overflow-hidden rounded-sm",
                  SURFACE_PATTERN_CLASS[surface],
                )}
              >
                <CourtLines />
                {/* White masks the loss share, from the top down, so the
                    court itself — colour, texture and lines together — is
                    what grows with the win rate, animating in on mount
                    rather than snapping straight to its final height. */}
                <div
                  className="absolute inset-x-0 top-0 bg-white transition-[height] duration-1000 ease-out"
                  style={{ height: revealed ? `${100 - winRate}%` : "100%" }}
                  aria-hidden="true"
                />
              </div>
              <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />
                {SURFACE_LABEL[surface]}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
}
