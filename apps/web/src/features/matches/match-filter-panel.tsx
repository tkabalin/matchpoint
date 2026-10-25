import type { PlayerRead, Surface } from "@matchpoint/api-client";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { DateField } from "@/components/date-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SURFACE_ICON, SURFACE_LABEL } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

import {
  DEFAULT_FILTERS,
  RESULT_LABEL,
  isActive,
  type MatchFilters,
  type PlayerFilter,
  type ResultFilter,
} from "./match-filters";

function playerName(player: Pick<PlayerRead, "first_name" | "last_name">): string {
  return `${player.first_name} ${player.last_name}`;
}

/**
 * The date/opponent/surface/result filter row shared by the coach's own
 * matches list and a player's own (#300 — the player side had no filter
 * panel at all, dropped entirely rather than just losing the one row that
 * genuinely doesn't apply to it). `players`, left `undefined`, is what tells
 * this apart: a coach's roster-wide list passes it and gets the Player
 * select too; a player's own list, scoped server-side to just their own
 * matches, has nothing for that select to even offer, so the prop is simply
 * never passed rather than passed as an always-one-item list.
 */
export function MatchFilterPanel({
  filters,
  onFiltersChange,
  players,
  filteredCount,
  totalCount,
}: {
  filters: MatchFilters;
  onFiltersChange: (filters: MatchFilters) => void;
  players?: PlayerRead[];
  filteredCount: number;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const playersById = new Map((players ?? []).map((player) => [player.id, player]));

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 rounded-sm border bg-card px-3.5 py-2.5 text-left"
      >
        <SlidersHorizontal className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold">
          {isActive(filters) ? `Filtered · ${filteredCount} of ${totalCount}` : "All matches"}
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
              <DateField
                id="matches-from"
                value={filters.from}
                onChange={(from) => onFiltersChange({ ...filters, from })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="matches-to"
                className="text-[0.625rem] text-muted-foreground uppercase"
              >
                To
              </label>
              <DateField
                id="matches-to"
                value={filters.to}
                onChange={(to) => onFiltersChange({ ...filters, to })}
              />
            </div>
          </div>

          <Input
            aria-label="Search opponent"
            placeholder="Search opponent"
            value={filters.opponent}
            onChange={(event) => onFiltersChange({ ...filters, opponent: event.target.value })}
          />

          {players && (
            <Select
              value={filters.player}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, player: value as PlayerFilter })
              }
            >
              <SelectTrigger aria-label="Player">
                <SelectValue>
                  {(value: string) => {
                    const player = playersById.get(value);
                    return value === "all" || !player ? "Any player" : playerName(player);
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any player</SelectItem>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {playerName(player)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Select
              value={filters.surface}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, surface: value as MatchFilters["surface"] })
              }
            >
              <SelectTrigger aria-label="Surface">
                <SelectValue>
                  {(value: string) => {
                    if (value === "all") return "Any surface";
                    const SurfaceIcon = SURFACE_ICON[value as Surface];
                    return (
                      <>
                        <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />
                        {SURFACE_LABEL[value as Surface]}
                      </>
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any surface</SelectItem>
                {(Object.entries(SURFACE_LABEL) as [Surface, string][]).map(([value, label]) => {
                  const SurfaceIcon = SURFACE_ICON[value];
                  return (
                    <SelectItem key={value} value={value}>
                      <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <Select
              value={filters.result}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, result: value as ResultFilter })
              }
            >
              <SelectTrigger aria-label="Result">
                <SelectValue>{(value: string) => RESULT_LABEL[value as ResultFilter]}</SelectValue>
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
            onClick={() => onFiltersChange(DEFAULT_FILTERS)}
            disabled={!isActive(filters)}
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
