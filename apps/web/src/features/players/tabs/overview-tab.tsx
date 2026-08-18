import type { PlayerRead } from "@matchpoint/api-client";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";

import { BulletBar } from "@/components/bullet-bar";
import { OutcomeStack, OutcomeSwatch } from "@/components/outcome-swatch";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlayerOverviewOptions } from "@/lib/analytics/analytics-options";
import { metricToBullet } from "@/lib/analytics/format";
import type { WinLossRecord } from "@/lib/analytics/types.provisional";

export function OverviewTab({
  player,
  onOpenTab,
}: {
  player: PlayerRead;
  onOpenTab: (tab: string) => void;
}) {
  const playerId = player.id;
  const { data, isPending } = useQuery(getPlayerOverviewOptions({ path: { player_id: playerId } }));

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <StatCard>
        <BulletBar
          {...metricToBullet(data.form, {
            hero: true,
            coachNote: "Up 12 pts over 5 matches — form is trending well.",
          })}
          scale={["0", "100"]}
        />
        <div className="flex gap-1.5">
          {data.recentResults.map((result, index) => (
            <OutcomeSwatch
              key={index}
              size="lg"
              pattern={result === "win" ? "win" : "unforced"}
              label={result === "win" ? "W" : "L"}
            />
          ))}
        </div>
      </StatCard>

      {/* Each headline stat opens the tab that explains it — the overview is a
          summary, and the obvious next question is always "why?". */}
      <DrillDown onClick={() => onOpenTab("serve")}>
        <BulletBar {...metricToBullet(data.holdPercentage)} />
      </DrillDown>
      <DrillDown onClick={() => onOpenTab("serve")}>
        <BulletBar {...metricToBullet(data.returnGamesWon)} />
      </DrillDown>
      <DrillDown onClick={() => onOpenTab("rally")}>
        <BulletBar {...metricToBullet(data.winnerToUnforced)} />
      </DrillDown>

      <StatCard title="Win/loss record">
        <RecordRow label="Season" record={data.seasonRecord} />
        <RecordRow label="All-time" record={data.allTimeRecord} />
      </StatCard>

      <StatCard title="Highlights">
        {data.highlights.map((highlight) => (
          <p
            key={highlight.text}
            className={
              highlight.direction === "up"
                ? "flex items-center gap-1.5 text-xs text-outcome-win"
                : "flex items-center gap-1.5 text-xs text-outcome-unforced"
            }
          >
            {highlight.direction === "up" ? (
              <TrendingUp className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <TrendingDown className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            {highlight.text}
          </p>
        ))}
      </StatCard>

      <StatCard title="Player details">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd>{player.date_of_birth ?? "—"}</dd>
          <dt className="text-muted-foreground">Dominant hand</dt>
          <dd className="capitalize">{player.dominant_hand ?? "—"}</dd>
          <dt className="text-muted-foreground">Notes</dt>
          <dd>{player.notes ?? "—"}</dd>
        </dl>
      </StatCard>

      {data.upcoming && (
        <button type="button" onClick={() => onOpenTab("h2h")} className="text-left">
          <StatCard>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span>{`Upcoming: vs ${data.upcoming.opponentName}, ${data.upcoming.when}`}</span>
              <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
            </div>
            <p className="text-[0.625rem] text-muted-foreground">{data.upcoming.note}</p>
          </StatCard>
        </button>
      )}
    </div>
  );
}

function DrillDown({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <StatCard>{children}</StatCard>
    </button>
  );
}

function RecordRow({ label, record }: { label: string; record: WinLossRecord }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums">{`${record.wins}–${record.losses}`}</span>
      </div>
      <OutcomeStack
        className="mt-1"
        segments={[
          { pattern: "win", weight: record.wins, label: `${record.wins} won` },
          { pattern: "unforced", weight: record.losses, label: `${record.losses} lost` },
        ]}
      />
    </div>
  );
}
