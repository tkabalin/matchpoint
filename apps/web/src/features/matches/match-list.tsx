import type { MatchRead, PlayerRead, Surface } from "@matchpoint/api-client";
import { listMatchesOptions, listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SURFACE_LABEL } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

import { MatchCard } from "./match-card";

type ResultFilter = "all" | "win" | "loss" | "unfinished";
type SurfaceFilter = "all" | Surface;

type PlayerFilter = "all" | string;

interface MatchFilters {
  from: string;
  to: string;
  opponent: string;
  surface: SurfaceFilter;
  result: ResultFilter;
  player: PlayerFilter;
}

const DEFAULT_FILTERS: MatchFilters = {
  from: "",
  to: "",
  opponent: "",
  surface: "all",
  result: "all",
  player: "all",
};

const RESULT_LABEL: Record<ResultFilter, string> = {
  all: "Any result",
  win: "Wins",
  loss: "Losses",
  unfinished: "Unfinished",
};

function matchesFilters(match: MatchRead, filters: MatchFilters): boolean {
  if (filters.from && match.played_on < filters.from) return false;
  if (filters.to && match.played_on > filters.to) return false;
  if (
    filters.opponent.trim() &&
    !(match.opponent_name ?? "").toLowerCase().includes(filters.opponent.trim().toLowerCase())
  ) {
    return false;
  }
  if (filters.surface !== "all" && match.surface !== filters.surface) return false;
  if (filters.result === "win" && match.result !== "win") return false;
  if (filters.result === "loss" && match.result !== "loss") return false;
  if (filters.result === "unfinished" && match.result !== null) return false;
  if (filters.player !== "all" && match.player_id !== filters.player) return false;
  return true;
}

function isActive(filters: MatchFilters): boolean {
  return (
    filters.from !== "" ||
    filters.to !== "" ||
    filters.opponent.trim() !== "" ||
    filters.surface !== "all" ||
    filters.result !== "all" ||
    filters.player !== "all"
  );
}

function playerName(player: Pick<PlayerRead, "first_name" | "last_name"> | undefined): string {
  return player ? `${player.first_name} ${player.last_name}` : "Unknown player";
}

export function MatchList({
  onEdit,
  onDelete,
}: {
  onEdit: (match: MatchRead) => void;
  onDelete: (match: MatchRead) => void;
}) {
  const { data, isPending, isError } = useQuery(listMatchesOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const playersById = new Map((players ?? []).map((player) => [player.id, player]));

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load matches.</AlertDescription>
      </Alert>
    );
  }

  if (data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matches yet</EmptyTitle>
          <EmptyDescription>Matches you record will be listed here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const filtered = data.filter((match) => matchesFilters(match, filters));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-3 rounded-sm border bg-card px-3.5 py-2.5 text-left"
        >
          <SlidersHorizontal className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="flex-1 text-sm font-semibold">
            {isActive(filters) ? `Filtered · ${filtered.length} of ${data.length}` : "All matches"}
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
          <div className="flex flex-col gap-3 rounded-sm border bg-card p-3.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="matches-from"
                  className="text-[0.625rem] text-muted-foreground uppercase"
                >
                  From
                </label>
                <Input
                  id="matches-from"
                  type="date"
                  value={filters.from}
                  onChange={(event) => setFilters({ ...filters, from: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="matches-to"
                  className="text-[0.625rem] text-muted-foreground uppercase"
                >
                  To
                </label>
                <Input
                  id="matches-to"
                  type="date"
                  value={filters.to}
                  onChange={(event) => setFilters({ ...filters, to: event.target.value })}
                />
              </div>
            </div>

            <Input
              aria-label="Search opponent"
              placeholder="Search opponent"
              value={filters.opponent}
              onChange={(event) => setFilters({ ...filters, opponent: event.target.value })}
            />

            <Select
              value={filters.player}
              onValueChange={(value) => setFilters({ ...filters, player: value as PlayerFilter })}
            >
              <SelectTrigger aria-label="Player">
                <SelectValue>
                  {(value: string) =>
                    value === "all" ? "Any player" : playerName(playersById.get(value))
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any player</SelectItem>
                {(players ?? []).map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {playerName(player)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <Select
                value={filters.surface}
                onValueChange={(value) =>
                  setFilters({ ...filters, surface: value as SurfaceFilter })
                }
              >
                <SelectTrigger aria-label="Surface">
                  <SelectValue>
                    {(value: string) =>
                      value === "all" ? "Any surface" : SURFACE_LABEL[value as Surface]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any surface</SelectItem>
                  {(Object.entries(SURFACE_LABEL) as [Surface, string][]).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.result}
                onValueChange={(value) => setFilters({ ...filters, result: value as ResultFilter })}
              >
                <SelectTrigger aria-label="Result">
                  <SelectValue>
                    {(value: string) => RESULT_LABEL[value as ResultFilter]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(RESULT_LABEL) as [ResultFilter, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              disabled={!isActive(filters)}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">No matches match those filters.</p>
      ) : (
        filtered.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            player={playersById.get(match.player_id)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}

export type { MatchFilters, PlayerFilter, ResultFilter, SurfaceFilter };
