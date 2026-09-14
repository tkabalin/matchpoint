import { CircleCheck, CircleX, Swords, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ForcedUnforcedBalance } from "@/components/forced-unforced-balance";
import { StatCard } from "@/components/stat-card";
import { squadHeadline } from "@/lib/analytics/squad-stats";
import type { SquadStatsEntry } from "@/lib/analytics/types.provisional";

/** Icon + big number + small label, three across — `StatHero`'s own DNA at a
 *  size that actually fits three in a row at `max-w-md`. Not promoted to
 *  `components/`, since it only has this one call site. */
function HeadlineStat({
  icon: Icon,
  value,
  label,
  children,
}: {
  icon: LucideIcon;
  value: ReactNode;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <span className="flex items-center gap-2 text-xl font-bold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

export function SquadHeadlineCard({ entries }: { entries: SquadStatsEntry[] }) {
  const headline = squadHeadline(entries);
  const matchWord = headline.matchesThisPeriod === 1 ? "match" : "matches";

  return (
    <StatCard note={`Squad · ${headline.matchesThisPeriod} ${matchWord} this period`}>
      <div className="flex justify-between gap-2">
        <HeadlineStat
          icon={Trophy}
          label="Win record"
          value={
            <>
              <span className="flex items-center gap-1 text-outcome-win">
                <CircleCheck className="size-4" aria-hidden="true" />
                {headline.record.wins}
              </span>
              <span className="flex items-center gap-1 text-outcome-unforced">
                <CircleX className="size-4" aria-hidden="true" />
                {headline.record.losses}
              </span>
            </>
          }
        />
        {/* Swords, not Target — Target already means "your serve" (serve-tab.tsx's
            hero icon); Swords matches home.tsx's own Forced:Unforced rows, per
            .claude/rules/web-icons.md's canonical registry. Split counts, not the
            ratio, plus the same weight visual the player card uses — a bare ratio
            can't tell "12 forcing shots, no mistakes" from "12 forcing shots, 1
            mistake" apart. */}
        <HeadlineStat
          icon={Swords}
          label="Forced : Unforced"
          value={`${headline.forcedCount} | ${headline.unforcedCount}`}
        >
          <ForcedUnforcedBalance
            forced={headline.forcedCount}
            unforced={headline.unforcedCount}
            className="max-w-24"
          />
        </HeadlineStat>
        {/* CircleCheck, not Flag — Flag/FlagOff is reserved for the Serve tab's
            1st/2nd serve toggle pair; standing alone with no FlagOff beside it,
            Flag means nothing here. CircleCheck reuses the Won/in/success
            concept, since "in" is literally what this figure measures
            (.claude/rules/web-icons.md). */}
        <HeadlineStat
          icon={CircleCheck}
          label="First serves landing in play"
          value={
            headline.firstServeInPercent === null
              ? "—"
              : `${Math.round(headline.firstServeInPercent)}%`
          }
        />
      </div>
    </StatCard>
  );
}
