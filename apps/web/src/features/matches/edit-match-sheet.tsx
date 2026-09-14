import type { MatchRead, ScoringSystem, Surface } from "@matchpoint/api-client";
import { updateMatch } from "@matchpoint/api-client";
import { getMatchQueryKey, listMatchesQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  MATCH_EVENT_MAX,
  MATCH_OPPONENT_MAX,
  buildMatchUpdateBody,
  matchFormValuesFrom,
  type MatchFormValues,
} from "@/lib/match-form";
import { parseErrorMessage } from "@/lib/parse-error";
import { SCORING_SYSTEM_LABEL, SURFACE_ICON, SURFACE_LABEL } from "@/lib/tennis-labels";

const NONE = "none";

const SURFACE_OPTIONS = Object.entries(SURFACE_LABEL) as [Surface, string][];
const SCORING_SYSTEM_OPTIONS = Object.entries(SCORING_SYSTEM_LABEL) as [ScoringSystem, string][];

type Step = "form" | "confirm-save";

/**
 * Editing a match's own metadata (#199) — opponent, date, surface, scoring
 * system, event. Same diff-only-PATCH shape as `EditPlayerSheet`: `save`
 * only sends the fields that actually changed. A plain confirm step before
 * saving is the "second popup" this action needs, same as delete's.
 *
 * Still offered once the match is complete (#228): finishing one freezes only its
 * result and its scoring system, the rulebook its points were scored under. Everything
 * else stays editable, since correcting a typo in the opponent or the date fixes the
 * analytics that read them rather than rewriting a match already played. The scoring
 * system is shown locked rather than hidden, so it is clear the field exists and why
 * it cannot move.
 */
export function EditMatchSheet({
  match,
  open,
  onOpenChange,
}: {
  match: MatchRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("form");
  const [values, setValues] = useState<MatchFormValues>(() => matchFormValuesFrom(match));
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("form");
    setValues(matchFormValuesFrom(match));
    setError(null);
  }

  function update<K extends keyof MatchFormValues>(key: K, value: MatchFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const body = buildMatchUpdateBody(match, values);
  // Mirrors the server's own predicate: a field still null has never been set, so a
  // completed match can still have its scoring system filled in for the first time.
  const scoringSystemLocked = match.result !== null && match.scoring_system !== null;
  const hasChanges = Object.keys(body).length > 0;
  const opponentLabel = match.opponent_name ?? "Unknown opponent";

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      const { error: updateError } = await updateMatch({ path: { match_id: match.id }, body });
      if (updateError) throw updateError;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getMatchQueryKey({ path: { match_id: match.id } }),
        }),
        queryClient.invalidateQueries({ queryKey: listMatchesQueryKey() }),
      ]);
      reset();
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setStep("form");
      setError(parseErrorMessage(mutationError, "Could not save those changes."));
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        {step === "form" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>{`Edit vs ${opponentLabel}`}</SheetTitle>
            </SheetHeader>

            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                if (!hasChanges) {
                  onOpenChange(false);
                  return;
                }
                setStep("confirm-save");
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="match-opponent">Opponent</FieldLabel>
                  <Input
                    id="match-opponent"
                    value={values.opponentName}
                    maxLength={MATCH_OPPONENT_MAX}
                    onChange={(event) => update("opponentName", event.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="match-played-on">Date</FieldLabel>
                  <Input
                    id="match-played-on"
                    type="date"
                    value={values.playedOn}
                    onChange={(event) => update("playedOn", event.target.value)}
                  />
                </Field>

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="match-surface">Surface</FieldLabel>
                  <Select
                    value={values.surface === "" ? NONE : values.surface}
                    onValueChange={(value) =>
                      update("surface", value === NONE ? "" : (value as Surface))
                    }
                  >
                    <SelectTrigger id="match-surface">
                      <SelectValue>
                        {(value: string) => {
                          if (value === NONE) return "Unspecified";
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
                      <SelectItem value={NONE}>Unspecified</SelectItem>
                      {SURFACE_OPTIONS.map(([value, label]) => {
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
                </Field>

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="match-scoring-system">Scoring system</FieldLabel>
                  <Select
                    value={values.scoringSystem === "" ? NONE : values.scoringSystem}
                    disabled={scoringSystemLocked}
                    onValueChange={(value) =>
                      update("scoringSystem", value === NONE ? "" : (value as ScoringSystem))
                    }
                  >
                    <SelectTrigger id="match-scoring-system">
                      <SelectValue>
                        {(value: string) =>
                          value === NONE
                            ? "Unspecified"
                            : SCORING_SYSTEM_LABEL[value as ScoringSystem]
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unspecified</SelectItem>
                      {SCORING_SYSTEM_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {scoringSystemLocked && (
                  <p className="text-xs text-muted-foreground">
                    The scoring system is fixed once a match is finished: its points were scored
                    under it.
                  </p>
                )}

                <Field>
                  <FieldLabel htmlFor="match-event">Event</FieldLabel>
                  <Input
                    id="match-event"
                    value={values.event}
                    maxLength={MATCH_EVENT_MAX}
                    onChange={(event) => update("event", event.target.value)}
                  />
                </Field>
              </FieldGroup>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full">
                Save changes
              </Button>
            </form>
          </>
        ) : (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Save these changes?</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">
              This updates the match {`vs ${opponentLabel}`}.
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="button" disabled={isSaving} className="w-full" onClick={() => save()}>
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              className="w-full"
              onClick={() => setStep("form")}
            >
              Cancel
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
