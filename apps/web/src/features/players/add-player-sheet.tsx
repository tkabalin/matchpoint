import { createPlayer } from "@matchpoint/api-client";
import { listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { parseErrorMessage } from "@/lib/parse-error";

type Hand = "right" | "left";

/**
 * Adding a player, from the roster's floating action.
 *
 * Only the two required fields are asked for up front — the brief calls for rapid
 * setup, and the rest is editable on the profile afterwards.
 */
export function AddPlayerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [hand, setHand] = useState<Hand>("right");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFirstName("");
    setLastName("");
    setHand("right");
    setNotes("");
    setError(null);
  }

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { data, error: createError } = await createPlayer({
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          dominant_hand: hand,
          notes: notes.trim() === "" ? null : notes.trim(),
        },
      });
      if (createError) throw createError;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });
      reset();
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not add that player."));
    },
  });

  const canSubmit = firstName.trim() !== "" && lastName.trim() !== "" && !isPending;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Add a player</SheetTitle>
        </SheetHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            mutate();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="first-name">First name</FieldLabel>
              <Input
                id="first-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="last-name">Last name</FieldLabel>
              <Input
                id="last-name"
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="dominant-hand">Dominant hand</FieldLabel>
              <SegmentedControl
                aria-label="Dominant hand"
                value={hand}
                onValueChange={setHand}
                options={[
                  { value: "right", label: "Right" },
                  { value: "left", label: "Left" },
                ]}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="player-notes">Notes</FieldLabel>
              <Textarea
                id="player-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything worth remembering before the first session"
              />
            </Field>
          </FieldGroup>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {isPending ? "Adding…" : "Add player"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
