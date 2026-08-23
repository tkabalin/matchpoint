import { getMatchOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleX,
  Repeat2,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";

import { ChipRow } from "@/components/chip-row";
import { AppPage, PageHeader } from "@/components/page-shell";
import { RallyTab } from "@/components/rally-tab";
import { SegmentedControl } from "@/components/segmented-control";
import { ServeTab } from "@/components/serve-tab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PHASE_OPTIONS, SET_OPTIONS } from "@/lib/analytics/filter-options";
import type { PhaseFilter, SetFilter } from "@/lib/analytics/types.provisional";
import { SURFACE_LABEL } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

import { formatPlayedOn } from "./match-format";

const routeApi = getRouteApi("/_authenticated/matches/$matchId");

type Tab = "serve" | "rally";

/**
 * The per-match counterpart to the player stats page (#199/#213 follow-up):
 * "click a match, see its own stats" — the same Serve/Rally tabs the player
 * page uses, reused verbatim and scoped to this one match's own (still
 * fixture-backed) data instead of the player's whole history. No opponent/
 * scope picker here — a match already has exactly one opponent — but Set/
 * Phase still narrows within this match's own sets.
 */
export function MatchStatsPage() {
  const { matchId } = routeApi.useParams();
  const [tab, setTab] = useState<Tab>("serve");
  const [set, setSet] = useState<SetFilter>("all");
  const [phase, setPhase] = useState<PhaseFilter>("full");
  const {
    data: match,
    isPending,
    isError,
  } = useQuery(getMatchOptions({ path: { match_id: matchId } }));

  if (isPending) {
    return (
      <AppPage nav={false}>
        <Skeleton className="h-96 w-full" />
      </AppPage>
    );
  }

  if (isError) {
    return (
      <AppPage nav={false}>
        <Alert variant="destructive">
          <AlertDescription>Could not load that match.</AlertDescription>
        </Alert>
      </AppPage>
    );
  }

  const opponent = match.opponent_name ?? "Unknown opponent";
  const detail = [formatPlayedOn(match.played_on), match.surface && SURFACE_LABEL[match.surface]]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppPage nav={false}>
      <PageHeader
        title={`vs ${opponent}`}
        subtitle={detail}
        back={
          <Link
            to="/matches"
            aria-label="Back to matches"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
        trailing={
          match.result &&
          (match.result === "win" ? (
            <CircleCheck className="size-7 text-outcome-win" role="img" aria-label="Won" />
          ) : (
            <CircleX className="size-7 text-outcome-unforced" role="img" aria-label="Lost" />
          ))
        }
      />

      <MatchStatsFilterPanel
        set={set}
        phase={phase}
        onSetChange={setSet}
        onPhaseChange={setPhase}
      />

      <SegmentedControl
        aria-label="Serve or rally"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "serve", label: "Serve", icon: CircleDot },
          { value: "rally", label: "Rally", icon: Repeat2 },
        ]}
      />

      <div className="mt-4">
        {tab === "serve" ? (
          <ServeTab playerId={match.player_id} matchId={matchId} set={set} phase={phase} />
        ) : (
          <RallyTab playerId={match.player_id} matchId={matchId} set={set} phase={phase} />
        )}
      </div>
    </AppPage>
  );
}

function MatchStatsFilterPanel({
  set,
  phase,
  onSetChange,
  onPhaseChange,
}: {
  set: SetFilter;
  phase: PhaseFilter;
  onSetChange: (set: SetFilter) => void;
  onPhaseChange: (phase: PhaseFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = set !== "all" || phase !== "full";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 rounded-sm border bg-card px-3.5 py-2.5 text-left"
      >
        <SlidersHorizontal className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold">
          {isActive ? "Narrowed within this match" : "Full match"}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="rounded-sm border bg-card p-3.5">
          <p className="mb-1.5 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
            Set
          </p>
          <ChipRow
            aria-label="Set"
            scroll
            options={SET_OPTIONS}
            value={set}
            onChange={onSetChange}
          />

          <p className="mt-3 mb-1.5 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
            Phase
          </p>
          <ChipRow
            aria-label="Phase"
            scroll
            options={PHASE_OPTIONS}
            value={phase}
            onChange={onPhaseChange}
          />
        </div>
      )}
    </div>
  );
}
