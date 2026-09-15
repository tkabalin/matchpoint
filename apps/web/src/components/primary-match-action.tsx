import { Link } from "@tanstack/react-router";
import { Play, Plus } from "lucide-react";

import { FAB_POSITION } from "@/components/fab-position";
import { buttonVariants } from "@/components/ui/button";
import { useInProgressSummary } from "@/features/capture/resume";
import { getRecordedOwner } from "@/lib/local-data";
import { cn } from "@/lib/utils";

/**
 * The match list's floating action, which is one control with two states rather
 * than two controls.
 *
 * While a match is being captured the only thing on offer is resuming it: starting
 * a second match from a screen that already has one running is how a coach ends up
 * with a half-recorded match they can't get back to. Reads the same device-local
 * signal the in-progress banner does (#251), not a server endpoint — see that
 * component's own comment for why.
 */
export function PrimaryMatchAction({ className }: { className?: string }) {
  const summary = useInProgressSummary(getRecordedOwner());

  if (summary !== null) {
    return (
      <Link
        to="/new-match/$playerId"
        params={{ playerId: summary.trackedPlayerId }}
        aria-label="Resume match in progress"
        className={cn(buttonVariants({ size: "icon" }), FAB_POSITION, className)}
      >
        <Play className="size-6" />
      </Link>
    );
  }

  return (
    <Link
      to="/new-match"
      aria-label="Start a match"
      className={cn(buttonVariants({ size: "icon" }), FAB_POSITION, className)}
    >
      <Plus className="size-6" />
    </Link>
  );
}
