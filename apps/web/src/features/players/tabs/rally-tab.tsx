import { useQuery } from "@tanstack/react-query";

import { BreakdownBars } from "@/components/breakdown-bars";
import { BulletBar } from "@/components/bullet-bar";
import { OutcomeLegend, OutcomeStack } from "@/components/outcome-swatch";
import { ShotRadar } from "@/components/shot-radar";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getRallyStatsOptions } from "@/lib/analytics/analytics-options";
import { metricToBullet } from "@/lib/analytics/format";

const OUTCOME_LEGEND = [
  { pattern: "win" as const, label: "Winner" },
  { pattern: "forced" as const, label: "Forced err" },
  { pattern: "unforced" as const, label: "Unforced err" },
];

export function RallyTab({ playerId }: { playerId: string }) {
  const { data, isPending } = useQuery(getRallyStatsOptions({ path: { player_id: playerId } }));

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <StatCard>
        <BulletBar {...metricToBullet(data.hero, { hero: true, coachNote: data.coachNote })} />
      </StatCard>

      <StatCard title="Winners by shot type" note="Scoped to point-ending shot, not full rally log">
        <BreakdownBars rows={data.winnersByShot} pattern="win" />
      </StatCard>

      <StatCard title="Errors by shot type">
        <BreakdownBars
          rows={data.errorsByShot}
          pattern="unforced"
          secondaryPattern="forced"
          legend={[
            { pattern: "unforced", label: "Unforced" },
            { pattern: "forced", label: "Forced" },
          ]}
        />
      </StatCard>

      <StatCard title="Point outcome mix — you vs opponents">
        {data.outcomeMix.map((mix) => (
          <div key={mix.label}>
            <p className="text-xs">{mix.label}</p>
            <OutcomeStack
              className="mt-1"
              segments={[
                { pattern: "win", weight: mix.winners, label: `${mix.winners}% winners` },
                {
                  pattern: "forced",
                  weight: mix.forcedErrors,
                  label: `${mix.forcedErrors}% forced errors`,
                },
                {
                  pattern: "unforced",
                  weight: mix.unforcedErrors,
                  label: `${mix.unforcedErrors}% unforced errors`,
                },
              ]}
            />
          </div>
        ))}
        <OutcomeLegend items={OUTCOME_LEGEND} className="mt-1" />
      </StatCard>

      <StatCard>
        <BulletBar {...metricToBullet(data.errorsUnderPressure)} />
      </StatCard>
      <StatCard>
        <BulletBar {...metricToBullet(data.errorsOverall)} />
      </StatCard>

      <StatCard title="Shot type frequency (point-enders)">
        <ShotRadar
          className="mx-auto aspect-square w-full max-w-64"
          series={[
            {
              name: "Share of point-enders",
              // Single-series chart: nav blue, no categorical colour needed.
              color: "var(--color-primary)",
              points: data.shotFrequency,
            },
          ]}
        />
      </StatCard>
    </div>
  );
}
