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
  { pattern: "forced" as const, label: "Forced" },
  { pattern: "unforced" as const, label: "Unforced" },
];

export function RallyTab({ playerId }: { playerId: string }) {
  const { data, isPending } = useQuery(getRallyStatsOptions({ path: { player_id: playerId } }));

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <StatCard>
        <BulletBar {...metricToBullet(data.hero, { hero: true, coachNote: data.coachNote })} />
      </StatCard>

      {/* Whose-shot rule (#175): on a win the stored shot is the player's own, on a
          loss the opponent's, so these two cards describe different people's shots. */}
      <StatCard title="Points won, by final shot" note="Your last shot on points you won">
        <BreakdownBars rows={data.winnersByShot} pattern="win" />
      </StatCard>

      <StatCard title="Points lost, by opponent's shot" note="What beat you, or drew the error">
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
                { pattern: "forced", weight: mix.forced, label: `${mix.forced}% forced` },
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
