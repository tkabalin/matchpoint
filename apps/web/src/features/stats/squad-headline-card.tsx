import { Flag, Swords, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { StatCard } from "@/components/stat-card";
import { squadHeadline } from "@/lib/analytics/squad-stats";
import type { SquadStatsEntry } from "@/lib/analytics/types.provisional";
import { formatRecord } from "@/lib/format-record";

/** Icon + big number + small label, three across — `StatHero`'s own DNA at a
 *  size that actually fits three in a row at `max-w-md`. Not promoted to
 *  `components/`, since it only has this one call site. */
function HeadlineStat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <span className="text-xl font-bold tabular-nums text-foreground">{value}</span>
      <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase">{label}</span>
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
          value={formatRecord(headline.record.wins, headline.record.losses)}
          label="Record"
        />
        {/* Swords, not Target — Target already means "your serve" (serve-tab.tsx's
            hero icon); Swords matches home.tsx's own Forced:Unforced rows, per
            .claude/rules/web-icons.md's canonical registry. */}
        <HeadlineStat
          icon={Swords}
          value={
            headline.forcedToUnforcedRatio === null
              ? "—"
              : headline.forcedToUnforcedRatio.toFixed(1)
          }
          label="Forced : Unforced"
        />
        <HeadlineStat
          icon={Flag}
          value={
            headline.firstServeInPercent === null
              ? "—"
              : `${Math.round(headline.firstServeInPercent)}%`
          }
          label="1st serve in %"
        />
      </div>
    </StatCard>
  );
}
