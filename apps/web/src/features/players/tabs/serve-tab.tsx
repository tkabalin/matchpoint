import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { BreakdownBars } from "@/components/breakdown-bars";
import { BulletBar } from "@/components/bullet-bar";
import { SegmentedControl } from "@/components/segmented-control";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getServeStatsOptions } from "@/lib/analytics/analytics-options";
import { metricToBullet } from "@/lib/analytics/format";

type Side = "serving" | "returning";

export function ServeTab({ playerId }: { playerId: string }) {
  const [side, setSide] = useState<Side>("serving");
  const { data, isPending } = useQuery(getServeStatsOptions({ path: { player_id: playerId } }));

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  const stats = data[side];

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        aria-label="Serve or return"
        value={side}
        onValueChange={setSide}
        options={[
          { value: "serving", label: "Serving" },
          { value: "returning", label: "Returning" },
        ]}
      />

      <StatCard>
        <BulletBar
          {...metricToBullet(stats.hero, { hero: true, coachNote: stats.coachNote })}
          scale={["0", "100"]}
        />
      </StatCard>

      {stats.metrics.map((metric) => (
        <StatCard key={metric.label}>
          <BulletBar {...metricToBullet(metric)} />
        </StatCard>
      ))}

      <StatCard
        title={
          side === "serving" ? "Winners/errors on serve, by shot type" : "Return points, by outcome"
        }
      >
        {/* Error rows sit alongside winner rows here, so they're coloured as the
            outcome they are rather than inheriting the group's. */}
        <BreakdownBars
          rows={stats.breakdown}
          pattern={(row) => (/fault|error/i.test(row.label) ? "unforced" : "win")}
        />
      </StatCard>

      {side === "serving" && (
        <p className="text-center text-[0.625rem] text-muted-foreground">
          Serve placement isn&rsquo;t captured yet — no grid shown.
        </p>
      )}
    </div>
  );
}
