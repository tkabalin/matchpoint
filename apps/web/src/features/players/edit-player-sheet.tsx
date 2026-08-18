import type { PlayerRead } from "@matchpoint/api-client";
import { updatePlayer } from "@matchpoint/api-client";
import { getPlayerQueryKey, listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PlayerFormFields } from "@/components/player-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseErrorMessage } from "@/lib/parse-error";
import {
  buildPlayerUpdateBody,
  type PlayerFormValues,
  playerFormValuesFrom,
  validatePlayerForm,
} from "@/lib/player-form";

/**
 * Editing an existing player. Same field set and validation as `AddPlayerSheet`
 * (`player-form.tsx`), reusing them because these are now the two real call sites for
 * that form. Differs from adding in three ways: it starts from the player's current
 * values instead of blank, it PATCHes only the fields that actually changed rather
 * than resending everything, and it has nothing to invalidate for an unchanged form —
 * see the no-op guard on submit below.
 */
export function EditPlayerSheet({
  player,
  open,
  onOpenChange,
}: {
  player: PlayerRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<PlayerFormValues>(() => playerFormValuesFrom(player));
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    // Back to the player's current values, not blank — this is the "ready for next
    // open" state, mirroring how AddPlayerSheet resets to BLANK_PLAYER_FORM on close.
    setValues(playerFormValuesFrom(player));
    setShowErrors(false);
    setError(null);
  }

  function update<K extends keyof PlayerFormValues>(key: K, value: PlayerFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const { isValid } = validatePlayerForm(values);
  const body = buildPlayerUpdateBody(player, values);
  const hasChanges = Object.keys(body).length > 0;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { data, error: updateError } = await updatePlayer({
        path: { player_id: player.id },
        body,
      });
      if (updateError) throw updateError;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getPlayerQueryKey({ path: { player_id: player.id } }),
        }),
        queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() }),
      ]);
      reset();
      onOpenChange(false);
    },
    onError: (mutationError) => {
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
        <SheetHeader className="p-0">
          <SheetTitle>Edit {player.first_name}</SheetTitle>
        </SheetHeader>

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setShowErrors(true);
            if (!isValid) return;
            // Nothing changed — closing is the correct response to "Save", not a
            // PATCH with an empty body.
            if (!hasChanges) {
              onOpenChange(false);
              return;
            }
            mutate();
          }}
        >
          <PlayerFormFields values={values} onChange={update} showErrors={showErrors} />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
