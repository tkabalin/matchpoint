/**
 * The match setup screen — what a match needs before its first point.
 *
 * Everything here is a field on `Match`, with one exception: the time is shown for the
 * coach's confirmation only, since `playedOn` is a calendar date and stores no time of
 * day on purpose (see match.ts). Which player the match is for is settled before this
 * screen, so it names them rather than asking.
 */

import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MATCH_EVENT_MAX } from "@/lib/match-form";
import { SCORING_SYSTEM_LABEL, SURFACE_LABEL } from "@/lib/tennis-labels";

import { SCORING_SYSTEMS, SURFACE_TYPES } from "./match";
import type { ScoringSystem, SurfaceType } from "./match";

// Surfaces carry "unspecified" here, which the API's own label map has no entry for —
// it types a coach's saved default, where the same idea is expressed by no value at all.
const SURFACE_LABELS: Record<SurfaceType, string> = {
  ...SURFACE_LABEL,
  unspecified: "Unspecified",
};

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
  onBack,
  onStart,
}: {
  playerName: string;
  // What this screen was last left holding, when a coach steps back into it from the
  // match's first screen. Coming back to a blank form would punish the trip.
  initial?: MatchSetupConfig | null;
  defaultScoringSystem?: ScoringSystem;
  defaultSurfaceType?: SurfaceType;
  onBack: () => void;
  onStart: (config: MatchSetupConfig) => void;
}) {
  const [opponentName, setOpponentName] = useState(initial?.opponentName ?? "");
  const [event, setEvent] = useState(initial?.event ?? "");
  const [scoringSystem, setScoringSystem] = useState<ScoringSystem>(
    initial?.scoringSystem ?? defaultScoringSystem,
  );
  const [surfaceType, setSurfaceType] = useState<SurfaceType>(
    initial?.surfaceType ?? defaultSurfaceType,
  );
  const [playerServesFirst, setPlayerServesFirst] = useState(initial?.playerServesFirst ?? true);
  // Frozen at mount: this is when the coach sat down, not when React last rendered.
  const [startedAt] = useState(() =>
    new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  );

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
          <span className="font-medium tabular-nums">{startedAt}</span>
        </div>

        <Field>
          <FieldLabel htmlFor="opponent" className="text-sm text-muted-foreground">
            Opponent
          </FieldLabel>
          <Input
            id="opponent"
            value={opponentName}
            placeholder="Name"
            onChange={(event) => {
              setOpponentName(event.target.value);
            }}
            className="h-11 rounded-lg text-sm"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="event" className="text-sm text-muted-foreground">
            Event
          </FieldLabel>
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
          <FieldLabel htmlFor="scoring-system" className="text-sm text-muted-foreground">
            Scoring system
          </FieldLabel>
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
          <FieldLabel htmlFor="court-type" className="text-sm text-muted-foreground">
            Court type
          </FieldLabel>
          <Select
            value={surfaceType}
            onValueChange={(value) => {
              setSurfaceType(value as SurfaceType);
            }}
          >
            <SelectTrigger id="court-type" className="h-11 rounded-lg text-sm">
              <SelectValue>{(value: string) => SURFACE_LABELS[value as SurfaceType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SURFACE_TYPES.map((surface) => (
                <SelectItem key={surface} value={surface}>
                  {SURFACE_LABELS[surface]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel className="text-sm text-muted-foreground">First serve</FieldLabel>
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

      <div className="flex-1" />

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
