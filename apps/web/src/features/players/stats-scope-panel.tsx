import { useQuery } from "@tanstack/react-query";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { listOpponentsOptions } from "@/lib/analytics/analytics-options";
import type {
  MatchScope,
  OpponentOption,
  PhaseFilter,
  SetFilter,
  StatsFilters,
} from "@/lib/analytics/types.provisional";
import { cn } from "@/lib/utils";

const SCOPE_OPTIONS: { value: MatchScope; label: string }[] = [
  { value: "all", label: "All matches" },
  { value: "vs-opponent", label: "vs opponent" },
];

const SET_OPTIONS: { value: SetFilter; label: string }[] = [
  { value: "all", label: "All sets" },
  { value: "1", label: "Set 1" },
  { value: "2", label: "Set 2" },
  { value: "3", label: "Set 3" },
];

const PHASE_OPTIONS: { value: PhaseFilter; label: string }[] = [
  { value: "full", label: "Full match" },
  { value: "tiebreaks", label: "Tiebreaks" },
  { value: "breakPoints", label: "Break points" },
  { value: "gamePoints", label: "Game points" },
  { value: "setPoints", label: "Set points" },
  { value: "matchPoints", label: "Match points" },
  { value: "gameEnding", label: "Game-ending" },
  { value: "setEnding", label: "Set-ending" },
];

const SET_LABEL: Record<SetFilter, string> = Object.fromEntries(
  SET_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SetFilter, string>;
const PHASE_LABEL: Record<PhaseFilter, string> = Object.fromEntries(
  PHASE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PhaseFilter, string>;

function ChipRow<T extends string>({
  options,
  value,
  onChange,
  scroll,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  scroll?: boolean;
  "aria-label": string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-1.5", scroll && "flex-nowrap overflow-x-auto pb-1")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap",
            value === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-transparent text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
 * No fixture yet varies by set/phase, so those two don't change the numbers on the
 * tab underneath. Recent form (rendered by the caller, above the tabs) is the one
 * exception: it's keyed by the committed opponent, so applying a "vs opponent"
 * scope really does change what's shown there.
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

  const opponentName =
    (opponents ?? []).find((opponent) => opponent.id === filters.opponentId)?.name ?? null;

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
                opponentId: scope === "vs-opponent" ? draft.opponentId : null,
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
                selectedId={draft.opponentId}
                onSelect={(opponentId) => setDraft({ ...draft, opponentId })}
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

          <Button
            type="button"
            className="mt-3 w-full"
            // "vs opponent" with nobody picked would commit as `{ scope:
            // "vs-opponent", opponentId: null }` — the trigger row then reads
            // "Choose opponent," an instruction sitting where a committed
            // value belongs, and Recent Form quietly falls back to the
            // all-matches record under it.
            disabled={draft.scope === "vs-opponent" && draft.opponentId === null}
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
  selectedId,
  onSelect,
}: {
  opponents: OpponentOption[];
  search: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
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
            key={opponent.id}
            opponent={opponent}
            selected={opponent.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const recent = opponents.filter((opponent) => opponent.recent);
  const rest = [...opponents.filter((opponent) => !opponent.recent)].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="flex flex-col gap-1 rounded-sm border">
      {recent.length > 0 && (
        <>
          <p className="px-2 pt-1.5 text-[0.5625rem] font-semibold text-muted-foreground uppercase">
            Most played
          </p>
          {recent.map((opponent) => (
            <OpponentRow
              key={opponent.id}
              opponent={opponent}
              selected={opponent.id === selectedId}
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
          key={opponent.id}
          opponent={opponent}
          selected={opponent.id === selectedId}
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
  opponent: OpponentOption;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Item
      variant="outline"
      size="sm"
      render={<button type="button" onClick={() => onSelect(opponent.id)} />}
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
