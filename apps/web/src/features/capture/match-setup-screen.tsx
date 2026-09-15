/**
 * The match setup screen — what a match needs before its first point.
 *
 * Everything here is a field on `Match`, with two exceptions: the date is shown for
 * the coach's confirmation only, since the `playedOn` that reaches the match is stamped
 * at creation rather than taken from here; and `previousOpponents`, which only backs the
 * Opponent field's suggestions and is never itself sent anywhere. Which player the match
 * is for is settled before this screen, so it names them rather than asking.
 */

import { ArrowLeft, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FieldLabelRow } from "@/components/field-label-row";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MATCH_EVENT_MAX } from "@/lib/match-form";
import { SCORING_SYSTEM_LABEL, SURFACE_ICON, SURFACE_LABEL } from "@/lib/tennis-labels";
import { cn } from "@/lib/utils";

import { SCORING_SYSTEMS, SURFACE_TYPES } from "./match";
import type { ScoringSystem, SurfaceType } from "./match";

// Surfaces carry "unspecified" here, which the API's own label map has no
// entry for. It types a coach's saved default, where the same idea is
// expressed by no value at all.
const SURFACE_LABELS: Record<SurfaceType, string> = {
  ...SURFACE_LABEL,
  unspecified: "Unspecified",
};

// "Unspecified" has no icon of its own, the same as "No preference"/"Unspecified"
// in the other two surface Selects (settings-match-defaults.tsx, edit-match-sheet.tsx).
function surfaceIconFor(surface: SurfaceType) {
  return surface === "unspecified" ? null : SURFACE_ICON[surface];
}

export interface MatchSetupConfig {
  opponentName: string;
  // The tournament or league this match belongs to. Optional — most matches are
  // practice or informal, so this is never a gate on starting (see `ready` below).
  event: string | null;
  scoringSystem: ScoringSystem;
  surfaceType: SurfaceType;
  // Not an id: this screen never sees one. The caller turns it into Match.firstServer.
  playerServesFirst: boolean;
}

export function MatchSetupScreen({
  playerName,
  initial,
  defaultScoringSystem = "traditional",
  defaultSurfaceType = "unspecified",
  previousOpponents = [],
  onBack,
  onStart,
}: {
  playerName: string;
  // What this screen was last left holding, when a coach steps back into it from the
  // match's first screen. Coming back to a blank form would punish the trip.
  initial?: MatchSetupConfig | null;
  defaultScoringSystem?: ScoringSystem;
  defaultSurfaceType?: SurfaceType;
  // Opponent names this player has faced before, most-met first. Handed in rather
  // than fetched here — this slice never touches the network (see match-setup-screen's
  // own module doc comment and .claude/rules/web-capture.md). Empty when there's
  // nothing to suggest, offline or otherwise — the suggestion list below just has no options.
  previousOpponents?: string[];
  onBack: () => void;
  onStart: (config: MatchSetupConfig) => void;
}) {
  const [opponentName, setOpponentName] = useState(initial?.opponentName ?? "");
  const [opponentListOpen, setOpponentListOpen] = useState(false);
  const opponentFieldRef = useRef<HTMLDivElement>(null);
  const [event, setEvent] = useState(initial?.event ?? "");
  const [scoringSystem, setScoringSystem] = useState<ScoringSystem>(
    initial?.scoringSystem ?? defaultScoringSystem,
  );
  const [surfaceType, setSurfaceType] = useState<SurfaceType>(
    initial?.surfaceType ?? defaultSurfaceType,
  );
  const [playerServesFirst, setPlayerServesFirst] = useState(initial?.playerServesFirst ?? true);
  // The date the match will be filed under, mirroring the `playedOn` its creation
  // stamps. A clock time is not recorded anywhere, so the header does not claim one.
  const playedOn = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const matchingOpponents = useMemo(() => {
    const query = opponentName.trim().toLowerCase();
    if (query.length === 0) return previousOpponents;
    return previousOpponents.filter((name) => name.toLowerCase().includes(query));
  }, [opponentName, previousOpponents]);

  // Closes on any tap outside the field — the input's own onBlur can't be trusted for
  // this, since tapping an option blurs the input before that option's click lands.
  useEffect(() => {
    if (!opponentListOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!opponentFieldRef.current?.contains(event.target as Node)) {
        setOpponentListOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [opponentListOpen]);

  const ready = opponentName.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Match</h1>
      </div>

      <div className="flex flex-col gap-[18px] px-0.5 pt-7">
        <div className="flex h-11 items-center justify-between rounded-lg border border-input px-3 text-sm">
          <span className="text-muted-foreground">{playerName}</span>
          <span className="font-medium tabular-nums">{playedOn}</span>
        </div>

        <Field>
          <FieldLabelRow htmlFor="opponent" required className="text-sm text-muted-foreground">
            Opponent
          </FieldLabelRow>
          {/* Hand-rolled, not a native <datalist>: iOS Safari's datalist dropdown never
              renders at all (see project memory capture-opponent-datalist-ios), so a
              suggestion list has to be drawn ourselves to work on the platform this app
              actually targets. Typing a name with no match still works — a first-time
              opponent isn't blocked by not being in the list. */}
          <div ref={opponentFieldRef} className="relative">
            <Input
              id="opponent"
              value={opponentName}
              placeholder="Name"
              autoComplete="off"
              role="combobox"
              aria-expanded={opponentListOpen && matchingOpponents.length > 0}
              aria-controls="previous-opponents-list"
              onChange={(event) => {
                setOpponentName(event.target.value);
                setOpponentListOpen(true);
              }}
              onFocus={() => {
                setOpponentListOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpponentListOpen(false);
                }
              }}
              className="h-11 rounded-lg pr-9 text-sm"
            />
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform",
                opponentListOpen && "rotate-180",
              )}
            />
            {opponentListOpen && matchingOpponents.length > 0 && (
              <div
                id="previous-opponents-list"
                role="listbox"
                className="absolute top-full right-0 left-0 z-20 mt-1 max-h-60 touch-pan-y touch-pinch-zoom overflow-x-hidden overflow-y-auto overscroll-contain rounded-sm bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
              >
                {matchingOpponents.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={name === opponentName}
                    onPointerDown={(event) => {
                      // Prevents the input's blur (which would close this list before
                      // the click below fires) when a touch/click starts on an option.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setOpponentName(name);
                      setOpponentListOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        <Field>
          <FieldLabelRow htmlFor="event" required={false} className="text-sm text-muted-foreground">
            Event
          </FieldLabelRow>
          <Input
            id="event"
            value={event}
            maxLength={MATCH_EVENT_MAX}
            onChange={(e) => {
              setEvent(e.target.value);
            }}
            className="h-11 rounded-lg text-sm"
          />
        </Field>

        <Field>
          <FieldLabelRow
            htmlFor="scoring-system"
            required={false}
            className="text-sm text-muted-foreground"
          >
            Scoring system
          </FieldLabelRow>
          <Select
            value={scoringSystem}
            onValueChange={(value) => {
              setScoringSystem(value as ScoringSystem);
            }}
          >
            <SelectTrigger id="scoring-system" className="h-11 rounded-lg text-sm">
              <SelectValue>
                {(value: string) => SCORING_SYSTEM_LABEL[value as ScoringSystem]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SCORING_SYSTEMS.map((system) => (
                <SelectItem key={system} value={system}>
                  {SCORING_SYSTEM_LABEL[system]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabelRow
            htmlFor="court-type"
            required={false}
            className="text-sm text-muted-foreground"
          >
            Court type
          </FieldLabelRow>
          <Select
            value={surfaceType}
            onValueChange={(value) => {
              setSurfaceType(value as SurfaceType);
            }}
          >
            <SelectTrigger id="court-type" className="h-11 rounded-lg text-sm">
              <SelectValue>
                {(value: string) => {
                  const surface = value as SurfaceType;
                  const SurfaceIcon = surfaceIconFor(surface);
                  return (
                    <>
                      {SurfaceIcon && (
                        <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      {SURFACE_LABELS[surface]}
                    </>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SURFACE_TYPES.map((surface) => {
                const SurfaceIcon = surfaceIconFor(surface);
                return (
                  <SelectItem key={surface} value={surface}>
                    {SurfaceIcon && <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />}
                    {SURFACE_LABELS[surface]}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabelRow required={false} className="text-sm text-muted-foreground">
            First serve
          </FieldLabelRow>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Player", value: true },
              { label: "Opponent", value: false },
            ].map((option) => (
              <Button
                key={option.label}
                variant={playerServesFirst === option.value ? "default" : "outline"}
                aria-pressed={playerServesFirst === option.value}
                onClick={() => {
                  setPlayerServesFirst(option.value);
                }}
                className="h-11 text-sm"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </Field>
      </div>

      {/* Pushes the action to the bottom, but keeps a gap when the viewport is too
          short for the spacer to grow. */}
      <div className="min-h-6 flex-1" />

      <Button
        disabled={!ready}
        onClick={() => {
          onStart({
            opponentName: opponentName.trim(),
            event: event.trim().length > 0 ? event.trim() : null,
            scoringSystem,
            surfaceType,
            playerServesFirst,
          });
        }}
        className="h-14 w-full text-base"
      >
        Start match
      </Button>
    </div>
  );
}
