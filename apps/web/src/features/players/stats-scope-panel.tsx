import type { OpponentSummary } from "@matchpoint/api-client";
import { listMatchesOptions, listOpponentsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { ChipRow } from "@/components/chip-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import {
  PHASE_LABEL,
  PHASE_OPTIONS,
  SCOPE_OPTIONS,
  SET_LABEL,
  SET_OPTIONS,
  SURFACE_VALUES,
} from "@/lib/analytics/filter-options";
import type { StatsFilters, SurfaceFilter } from "@/lib/analytics/types.provisional";
import { SURFACE_LABEL } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

// The real endpoint already sorts most-met opponent first, so the picker's
// "Most played" group is just that leading slice rather than a server-side
// flag — 3 to match how many the mockup's own grouping showed.
const MOST_PLAYED_COUNT = 3;

function summaryFor(filters: StatsFilters, opponentName: string | null): string {
  const scope = filters.scope === "all" ? "All matches" : (opponentName ?? "Choose opponent");
  // Set and Phase can both be committed at once (Set 2 + Tiebreaks is a real,
  // distinct selection from Set 2 alone), so the summary joins whichever of
  // the two aren't at their default rather than picking one and dropping the
  // other — the trigger row is the only feedback a coach has that the panel
  // committed both, since it closes on Apply.
  const parts = [
    scope,
    filters.set !== "all" && SET_LABEL[filters.set],
    filters.phase !== "full" && PHASE_LABEL[filters.phase],
    filters.surface !== "all" && SURFACE_LABEL[filters.surface],
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

/**
 * The Serve/Rally tabs' scope selector — a bordered trigger row that expands an
 * inline panel underneath it (not a bottom sheet, not a badge that cycles on tap).
 * Selections inside the panel are a local draft; only Apply commits them into
 * `filters` and collapses the panel, echoed back as the trigger row's own summary
 * text — matching the mockup exactly.
 *
 * Scope, Set and Phase all change the numbers on the tab underneath — Set and Phase
 * narrow via `set_number`/`phase` on the real endpoints; Scope's opponent axis
 * narrows via `opponent_key`, `OpponentSummary.key` as this picker returns it.
 */
export function StatsScopePanel({
  playerId,
  filters,
  onApply,
}: {
  playerId: string;
  filters: StatsFilters;
  onApply: (filters: StatsFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [opponentSearch, setOpponentSearch] = useState("");
  const { data: opponents } = useQuery(listOpponentsOptions({ path: { player_id: playerId } }));
  // Same query the "Performance by surface" card reads (same queryKey, so this
  // doesn't add a second request) — read here too so the surface chip row only
  // ever offers a surface this player actually has a match on (#225): a player
  // with only hard-court matches shouldn't see three dead chips.
  const { data: matches } = useQuery(listMatchesOptions({ query: { player_id: playerId } }));
  const presentSurfaces = SURFACE_VALUES.filter((surface) =>
    (matches ?? []).some((match) => match.surface === surface),
  );

  const opponentName =
    (opponents ?? []).find((opponent) => opponent.key === filters.opponentKey)?.name ?? null;

  function openPanel() {
    setDraft(filters);
    setOpponentSearch("");
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="flex items-center gap-3 rounded-sm border bg-card px-3.5 py-2.5 text-left"
      >
        <SlidersHorizontal className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold">{summaryFor(filters, opponentName)}</span>
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
          <ScopeGroupLabel first>Match scope</ScopeGroupLabel>
          <ChipRow
            aria-label="Match scope"
            options={SCOPE_OPTIONS}
            value={draft.scope}
            onChange={(scope) =>
              setDraft({
                ...draft,
                scope,
                opponentKey: scope === "vs-opponent" ? draft.opponentKey : null,
              })
            }
          />

          {draft.scope === "vs-opponent" && (
            <>
              <ScopeGroupLabel>Opponent</ScopeGroupLabel>
              <Input
                placeholder="Search opponents"
                value={opponentSearch}
                onChange={(event) => setOpponentSearch(event.target.value)}
                className="mb-1.5"
              />
              <OpponentPicker
                opponents={opponents ?? []}
                search={opponentSearch}
                selectedKey={draft.opponentKey}
                onSelect={(opponentKey) => setDraft({ ...draft, opponentKey })}
              />
            </>
          )}

          <ScopeGroupLabel>Set</ScopeGroupLabel>
          <ChipRow
            aria-label="Set"
            scroll
            options={SET_OPTIONS}
            value={draft.set}
            onChange={(set) => setDraft({ ...draft, set })}
          />

          <ScopeGroupLabel>Phase</ScopeGroupLabel>
          <ChipRow
            aria-label="Phase"
            scroll
            options={PHASE_OPTIONS}
            value={draft.phase}
            onChange={(phase) => setDraft({ ...draft, phase })}
          />

          {presentSurfaces.length > 0 && (
            <>
              <ScopeGroupLabel>Surface</ScopeGroupLabel>
              <ChipRow<SurfaceFilter>
                aria-label="Surface"
                scroll
                options={[
                  { value: "all", label: "All surfaces" },
                  ...presentSurfaces.map((surface) => ({
                    value: surface,
                    label: SURFACE_LABEL[surface],
                  })),
                ]}
                value={draft.surface}
                onChange={(surface) => setDraft({ ...draft, surface })}
              />
            </>
          )}

          <Button
            type="button"
            className="mt-3 w-full"
            // "vs opponent" with nobody picked would commit as `{ scope:
            // "vs-opponent", opponentKey: null }` — the trigger row then reads
            // "Choose opponent," an instruction sitting where a committed
            // value belongs, and Recent Form quietly falls back to the
            // all-matches record under it.
            disabled={draft.scope === "vs-opponent" && draft.opponentKey === null}
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}

function ScopeGroupLabel({ children, first }: { children: string; first?: boolean }) {
  return (
    <p
      className={cn(
        "mb-1.5 text-[0.625rem] tracking-wide text-muted-foreground uppercase",
        !first && "mt-3",
      )}
    >
      {children}
    </p>
  );
}

function OpponentPicker({
  opponents,
  search,
  selectedKey,
  onSelect,
}: {
  opponents: OpponentSummary[];
  search: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const query = search.trim().toLowerCase();

  if (query) {
    const matches = opponents.filter((opponent) => opponent.name.toLowerCase().includes(query));
    if (matches.length === 0) {
      return <p className="px-1 py-2 text-xs text-muted-foreground">No opponents match.</p>;
    }
    return (
      <div className="flex flex-col gap-1 rounded-sm border">
        {matches.map((opponent) => (
          <OpponentRow
            key={opponent.key}
            opponent={opponent}
            selected={opponent.key === selectedKey}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  // Already sorted most-met first by the endpoint itself.
  const mostPlayed = opponents.slice(0, MOST_PLAYED_COUNT);
  const rest = [...opponents.slice(MOST_PLAYED_COUNT)].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-1 rounded-sm border">
      {mostPlayed.length > 0 && (
        <>
          <p className="px-2 pt-1.5 text-[0.5625rem] font-semibold text-muted-foreground uppercase">
            Most played
          </p>
          {mostPlayed.map((opponent) => (
            <OpponentRow
              key={opponent.key}
              opponent={opponent}
              selected={opponent.key === selectedKey}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
      <p className="px-2 pt-1.5 text-[0.5625rem] font-semibold text-muted-foreground uppercase">
        All opponents
      </p>
      {rest.map((opponent) => (
        <OpponentRow
          key={opponent.key}
          opponent={opponent}
          selected={opponent.key === selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function OpponentRow({
  opponent,
  selected,
  onSelect,
}: {
  opponent: OpponentSummary;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <Item
      variant="outline"
      size="sm"
      render={<button type="button" onClick={() => onSelect(opponent.key)} />}
      className={cn(selected && "border-primary bg-primary/5")}
    >
      <ItemContent>
        <ItemTitle className={cn(selected && "text-primary")}>{opponent.name}</ItemTitle>
      </ItemContent>
      <span className={cn("text-xs text-muted-foreground", selected && "text-primary")}>
        {opponent.matches} {opponent.matches === 1 ? "match" : "matches"}
      </span>
    </Item>
  );
}
