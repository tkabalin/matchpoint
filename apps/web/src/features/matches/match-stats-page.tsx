import { getMatchOptions, listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Hash,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";

import { ChipRow } from "@/components/chip-row";
import { FilterGroupLabel } from "@/components/filter-group-label";
import { AppPage, PageHeader } from "@/components/page-shell";
import { RallyTab } from "@/components/rally-tab";
import { ServeRallyToggle } from "@/components/serve-rally-toggle";
import { ServeTab } from "@/components/serve-tab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PHASE_OPTIONS, SET_OPTIONS } from "@/lib/analytics/filter-options";
import type { PhaseFilter, SetFilter } from "@/lib/analytics/types.provisional";
import { SURFACE_LABEL } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

import { formatPlayedOn } from "./match-format";
import { MomentumCard } from "./momentum-card";

type Tab = "serve" | "rally";

/**
 * The per-match counterpart to the player stats page (#199/#213 follow-up):
 * "click a match, see its own stats" — the same Serve/Rally tabs the player
 * page uses, reused verbatim and scoped to this one match's own data instead
 * of the player's whole history. No opponent/scope picker here — a match
 * already has exactly one opponent — but Set/Phase still narrows within
 * this match's own sets.
 *
 * `matchId` and `backTo` are props rather than read off a hardcoded
 * `getRouteApi` id, because this mounts under two different routes now —
 * `/matches/$matchId` for a coach, `/me/matches/$matchId` for a player (#203)
 * — and each route file supplies its own correctly-bound params.
 *
 * `showPlayer` is the other thing those two routes disagree on. A coach reaches
 * this from a roster of several players, so which one's match it is has to be on
 * the page; a player only ever reaches their own, and the roster it would be read
 * from is coach-only anyway (a player session 401s on it, see
 * `player-self-view.tsx`).
 */
export function MatchStatsPage({
  matchId,
  backTo = "/matches",
  showPlayer = false,
}: {
  matchId: string;
  backTo?: string;
  showPlayer?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("serve");
  const [set, setSet] = useState<SetFilter>("all");
  const [phase, setPhase] = useState<PhaseFilter>("full");
  const {
    data: match,
    isPending,
    isError,
  } = useQuery(getMatchOptions({ path: { match_id: matchId } }));
  // The roster rather than `getPlayer`, for the same lookup `match-list.tsx` does:
  // it needs no `player_id` to start, so it runs alongside the match instead of
  // waiting a round trip for one, and the matches list the coach just came from has
  // usually warmed it already.
  const { data: players } = useQuery({ ...listPlayersOptions(), enabled: showPlayer });

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
  // Only once it resolves: until then, and for a player whose row is gone, the header
  // stays the one it was before rather than flashing a placeholder name as its title.
  const player = players?.find((candidate) => candidate.id === match.player_id);
  const detail = [
    player && `vs ${opponent}`,
    formatPlayedOn(match.played_on),
    match.surface && SURFACE_LABEL[match.surface],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppPage nav={false}>
      <PageHeader
        title={player ? `${player.first_name} ${player.last_name}` : `vs ${opponent}`}
        subtitle={detail}
        back={
          // Reachable from the matches list (match-card.tsx) and, since a completed
          // capture's "View results" also lands here, from wherever that match was
          // started — Home included. `backTo` is only the fallback for a direct/deep
          // link with nothing to pop, same reasoning as `start-match.tsx`'s own back
          // button; a fixed destination would send those other visits somewhere they
          // didn't come from.
          <button
            type="button"
            aria-label="Back"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            onClick={() => {
              if (router.history.canGoBack()) {
                router.history.back();
              } else {
                void router.navigate({ to: backTo });
              }
            }}
          >
            <ArrowLeft />
          </button>
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

      <MomentumCard matchId={matchId} matchFinished={match.result !== null} />

      <ServeRallyToggle value={tab} onValueChange={setTab} />

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
        <span className="flex-1 text-sm font-bold">
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
          <FilterGroupLabel icon={Hash} first>
            Set
          </FilterGroupLabel>
          <ChipRow
            aria-label="Set"
            scroll
            options={SET_OPTIONS}
            value={set}
            onChange={onSetChange}
          />

          <FilterGroupLabel icon={Clock}>Phase</FilterGroupLabel>
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
