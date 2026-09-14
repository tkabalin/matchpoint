import { cn } from "@/lib/utils";

/** Forced:unforced as a levelling tool rather than a proportion bar: a faint
 *  forced→unforced gradient track and a needle sitting at the unforced share
 *  of the two counts — centred when balanced, drifting into the unforced
 *  (vermillion) zone as errors mount, into the forced (orange) zone as forced
 *  errors dominate. Position is the accessible channel here: which side of
 *  centre the needle sits on reads without needing to tell the two hues
 *  apart. Shared by the player card and the Squad stats leaderboard. */
export function ForcedUnforcedBalance({
  forced,
  unforced,
  className,
}: {
  forced: number;
  unforced: number;
  className?: string;
}) {
  const total = forced + unforced;
  const unforcedShare = total === 0 ? 0.5 : unforced / total;
  const needlePercent = unforcedShare * 100;
  const leaning = unforcedShare > 0.5 ? "unforced" : unforcedShare < 0.5 ? "forced" : null;
  return (
    <div className={cn("relative mt-2 h-3 w-full", className)}>
      <div
        className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full opacity-30"
        style={{
          background:
            "linear-gradient(to right, var(--color-outcome-forced), var(--color-outcome-unforced))",
        }}
        aria-hidden="true"
      />
      <div
        className="absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/40"
        aria-hidden="true"
      />
      <div
        className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-px"
        style={{ left: `${needlePercent}%` }}
        aria-hidden="true"
      >
        <div
          className={cn(
            "size-2.5 rounded-full",
            leaning === "unforced"
              ? "bg-outcome-unforced"
              : leaning === "forced"
                ? "bg-outcome-forced"
                : "bg-foreground",
          )}
        />
        <div
          className={cn(
            "h-2.5 w-0.5",
            leaning === "unforced"
              ? "bg-outcome-unforced"
              : leaning === "forced"
                ? "bg-outcome-forced"
                : "bg-foreground",
          )}
        />
      </div>
    </div>
  );
}
