import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Share2 } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { BreakdownBars } from "@/components/breakdown-bars";
import { BulletBar } from "@/components/bullet-bar";
import { OutcomeSwatch } from "@/components/outcome-swatch";
import { SegmentedControl } from "@/components/segmented-control";
import { ShotRadar } from "@/components/shot-radar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { getHeadToHeadOptions, listHeadToHeadOptions } from "@/lib/analytics/analytics-options";
import { metricToBullet } from "@/lib/analytics/format";
import type { HeadToHeadSummary } from "@/lib/analytics/types.provisional";
import { PATTERN_VAR } from "@/lib/palette";
import { cn } from "@/lib/utils";

/** A win rate below this many meetings is noise dressed up as a percentage. */
const MIN_MEETINGS_FOR_RATE = 3;

export function H2hTab({ playerId }: { playerId: string }) {
  const [opponentId, setOpponentId] = useState<string | null>(null);

  return opponentId === null ? (
    <OpponentList playerId={playerId} onSelect={setOpponentId} />
  ) : (
    <OpponentDetail
      playerId={playerId}
      opponentId={opponentId}
      onBack={() => setOpponentId(null)}
    />
  );
}

function OpponentList({
  playerId,
  onSelect,
}: {
  playerId: string;
  onSelect: (opponentId: string) => void;
}) {
  const { data, isPending } = useQuery(listHeadToHeadOptions({ path: { player_id: playerId } }));

  if (isPending) return <Skeleton className="h-64 w-full" />;

  const opponents = data ?? [];

  if (opponents.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No head-to-head history yet</EmptyTitle>
          <EmptyDescription>Record a match to start building a matchup record.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {opponents.map((opponent) => (
        <OpponentRow key={opponent.opponentId} opponent={opponent} onSelect={onSelect} />
      ))}
      <p className="text-[0.625rem] text-muted-foreground">
        {`Win rate is shown from ${MIN_MEETINGS_FOR_RATE} meetings; below that, only the raw record.`}
      </p>
    </div>
  );
}

function OpponentRow({
  opponent,
  onSelect,
}: {
  opponent: HeadToHeadSummary;
  onSelect: (opponentId: string) => void;
}) {
  const { record, meetings, winRate } = opponent;
  const detail =
    winRate === null
      ? `n=${meetings} · ${record.wins}–${record.losses} · too few for a rate`
      : `n=${meetings} · ${record.wins}–${record.losses} · ${winRate}%`;

  return (
    <Item
      variant="outline"
      render={<button type="button" onClick={() => onSelect(opponent.opponentId)} />}
      // Thin evidence is dimmed rather than hidden: the meetings still happened,
      // they just can't carry a rate yet.
      className={cn("w-full text-left", winRate === null && "opacity-60")}
    >
      <ItemMedia>
        <OutcomeSwatch
          size="lg"
          pattern="indigo"
          label={opponent.opponentName.slice(0, 1).toUpperCase()}
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{opponent.opponentName}</ItemTitle>
        <ItemDescription>{detail}</ItemDescription>
      </ItemContent>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Item>
  );
}

function OpponentDetail({
  playerId,
  opponentId,
  onBack,
}: {
  playerId: string;
  opponentId: string;
  onBack: () => void;
}) {
  const [scope, setScope] = useState<"opponent" | "match">("opponent");
  const { data, isPending } = useQuery(
    getHeadToHeadOptions({ path: { player_id: playerId, opponent_id: opponentId } }),
  );

  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to opponents">
          <ArrowLeft />
        </Button>
        <h3 className="text-sm font-bold tracking-wide uppercase">{`vs ${data.opponentName}`}</h3>
      </div>

      <StatCard>
        <BulletBar {...metricToBullet(data.hero, { hero: true })} scale={["0", "100"]} />
        <div className="mt-1 flex gap-1.5">
          {data.results.map((result, index) => (
            <OutcomeSwatch
              key={index}
              pattern={result === "win" ? "win" : "unforced"}
              label={result === "win" ? "W" : "L"}
            />
          ))}
        </div>
        <p className="text-[0.625rem] text-muted-foreground">Meeting by meeting, oldest first</p>
      </StatCard>

      <StatCard className="border-outcome-win">
        <h3 className="text-[0.625rem] font-bold tracking-wide text-outcome-win uppercase">
          Exploit
        </h3>
        <p className="text-xs">{data.exploit}</p>
      </StatCard>
      <StatCard className="border-outcome-unforced">
        <h3 className="text-[0.625rem] font-bold tracking-wide text-outcome-unforced uppercase">
          Avoid
        </h3>
        <p className="text-xs">{data.avoid}</p>
      </StatCard>

      <StatCard
        title="Is the gap closing?"
        note={`First 2 vs last 2 meetings · n=${data.meetings}`}
        footnote="All three tilt up — the matchup is trending your way, not just the record."
      >
        <SlopeGraph slope={data.slope} />
      </StatCard>

      <SegmentedControl
        aria-label="Aggregate scope"
        value={scope}
        onValueChange={setScope}
        options={[
          { value: "opponent", label: "Per opponent" },
          { value: "match", label: "Per match" },
        ]}
      />

      <StatCard title={`How losses arrive (${data.record.losses} loss)`}>
        <BreakdownBars rows={data.lossPatterns} pattern="unforced" />
      </StatCard>

      <StatCard title="Serve — you serving">
        {data.yourServe.map((metric) => (
          <BulletBar key={metric.label} {...metricToBullet(metric)} />
        ))}
      </StatCard>

      <StatCard title={`Serve — ${data.opponentName} serving`}>
        {/* The opponent's own numbers are a category, not the coach's outcome, so
            they take the safe non-outcome set rather than green/red. */}
        {data.theirServe.map((metric, index) => (
          <BulletBar
            key={metric.label}
            {...metricToBullet(metric, { tone: index === 0 ? "violet" : "yellow" })}
          />
        ))}
      </StatCard>

      <StatCard title={`Winners by shot type, you vs ${data.opponentName}`}>
        <BreakdownBars rows={data.winnersByShot} pattern="win" />
      </StatCard>

      <StatCard title="Shot type frequency">
        <ShotRadar
          className="mx-auto aspect-square w-full max-w-64"
          series={[
            {
              name: "You",
              // Nav chrome is visible on this screen, so blue is off the table as a
              // category colour here (.claude/rules/web-color.md).
              color: PATTERN_VAR.violet,
              points: data.shotFrequency,
            },
          ]}
        />
      </StatCard>

      <Button variant="outline" disabled className="w-full">
        <Share2 />
        Share match report
      </Button>
    </div>
  );
}

/**
 * Three metrics, each drawn as its first-two vs last-two meeting average.
 *
 * Colours come from the safe non-outcome set and deliberately exclude blue: the
 * bottom nav is on screen, and blue is its.
 */
function SlopeGraph({ slope }: { slope: { label: string; first: number; last: number }[] }) {
  const colors = [PATTERN_VAR.yellow, PATTERN_VAR.indigo, PATTERN_VAR.violet];
  const data = [
    { stage: "First 2", ...Object.fromEntries(slope.map((line) => [line.label, line.first])) },
    { stage: "Last 2", ...Object.fromEntries(slope.map((line) => [line.label, line.last])) },
  ];
  const config = Object.fromEntries(
    slope.map((line, index) => [line.label, { label: line.label, color: colors[index] }]),
  );

  return (
    <ChartContainer config={config} className="aspect-[5/3] w-full">
      <LineChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
        <YAxis width={24} domain={[0, 100]} tick={{ fontSize: 9 }} />
        <ChartLegend content={<ChartLegendContent />} />
        {slope.map((line, index) => (
          <Line
            key={line.label}
            dataKey={line.label}
            stroke={colors[index]}
            strokeWidth={3}
            dot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
