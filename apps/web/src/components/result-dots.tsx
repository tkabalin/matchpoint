import type { MatchResult } from "@matchpoint/api-client";
import { History } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A win/loss sequence as filled-or-hollow dots, oldest first. Third call site
 * of what was duplicated inline in `player-record-card.tsx` and `home.tsx`
 * (`.claude/rules/web.md`'s two-call-site rule).
 *
 * Filled and hollow, not two colours: a loss dot never carries the outcome
 * red, since a losing streak isn't itself a bad-score band the way a single
 * ratio can be (`.claude/rules/web-color.md` reserves that palette for point
 * outcomes and hero score bands).
 */
export function ResultDots({
  results,
  label = "Last 5",
  className,
}: {
  results: MatchResult[];
  label?: string;
  className?: string;
}) {
  if (results.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <History className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="text-sm font-bold text-foreground">{label}</span>
      <div className="flex gap-1">
        {results.map((result, index) => (
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
    </div>
  );
}
