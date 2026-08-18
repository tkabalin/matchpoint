import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play, Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { getInProgressMatchOptions } from "@/lib/analytics/analytics-options";
import { cn } from "@/lib/utils";

/**
 * The match list's floating action, which is one control with two states rather
 * than two controls.
 *
 * While a match is being captured the only thing on offer is resuming it: starting
 * a second match from a screen that already has one running is how a coach ends up
 * with a half-recorded match they can't get back to.
 */
export function PrimaryMatchAction({ className }: { className?: string }) {
  const { data: inProgress } = useQuery(getInProgressMatchOptions());

  const position =
    // Tracks the page column's right edge rather than the viewport's, so it stays
    // beside the content once the screen is wider than the column.
    "fixed right-[max(1rem,calc(50%-13rem))] bottom-20 z-40 size-12 rounded-full shadow-lg";

  if (inProgress) {
    return (
      <Link
        to="/matches"
        aria-label={`Resume ${inProgress.playerName} vs ${inProgress.opponentName}`}
        className={cn(buttonVariants({ size: "icon" }), position, className)}
      >
        <Play className="size-6" />
      </Link>
    );
  }

  return (
    <Link
      to="/new-match"
      aria-label="Start a match"
      className={cn(buttonVariants({ size: "icon" }), position, className)}
    >
      <Plus className="size-6" />
    </Link>
  );
}
