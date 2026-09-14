import type { MatchResult } from "@matchpoint/api-client";
import { Check, History, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A win/loss sequence as filled-or-hollow dots, oldest first. Third call site
 * of what was duplicated inline in `player-record-card.tsx` and `home.tsx`
 * (`.claude/rules/web.md`'s two-call-site rule).
 *
 * Filled and hollow, not two colours: a loss dot never carries the outcome
 * red, since a losing streak isn't itself a bad-score band the way a single
 * ratio can be (`.claude/rules/web-color.md` reserves that palette for point
 * outcomes and hero score bands). A check/cross glyph inside each dot is the
 * pattern-rule's non-colour channel doing the same job here it does for every
 * other swatch in the app — filled-vs-hollow already carries it, but the
 * glyph makes it legible at this size without leaning in.
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
              "flex size-4 shrink-0 items-center justify-center rounded-full",
              result === "win"
                ? "bg-outcome-win text-white"
                : "border border-muted-foreground text-muted-foreground",
            )}
          >
            {result === "win" ? (
              <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            ) : (
              <X className="size-3" strokeWidth={3} aria-hidden="true" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
