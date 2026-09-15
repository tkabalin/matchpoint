import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** A filter panel's own section heading, shared by the player stats scope panel
 *  (`features/players/stats-scope-panel.tsx`) and the per-match stats page's
 *  smaller Set/Phase-only panel (`features/matches/match-stats-page.tsx`) — one
 *  component so both stay in step rather than drifting as two copies of the
 *  same markup, and so a filter group's icon stays the same icon in both places. */
export function FilterGroupLabel({
  icon: Icon,
  children,
  first,
}: {
  icon: LucideIcon;
  children: string;
  first?: boolean;
}) {
  return (
    <p
      className={cn(
        "mb-1.5 flex items-center gap-1.5 text-xs font-bold tracking-wide text-foreground uppercase",
        !first && "mt-3",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </p>
  );
}
