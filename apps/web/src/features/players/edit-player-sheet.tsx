import type { PlayerRead } from "@matchpoint/api-client";
import { deletePlayer, updatePlayer } from "@matchpoint/api-client";
import {
  getPlayerQueryKey,
  listMatchesQueryKey,
  listPlayersQueryKey,
} from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PhotoPickerSheet } from "@/components/photo-picker-sheet";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerFormFields } from "@/components/player-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getErrorStatus } from "@/lib/error-status";
import { parseErrorMessage } from "@/lib/parse-error";
import {
  buildPlayerUpdateBody,
  type PlayerFormValues,
  playerFormValuesFrom,
  validatePlayerForm,
} from "@/lib/player-form";
import { usePlayerPhoto } from "@/lib/use-player-photo";

type Step = "form" | "confirm-delete" | "delete-blocked";

// Same wording whether caught ahead of time from PlayerRead.has_transfer_code (below)
// or from the delete request's own 409 — the flag can go stale between a roster read
// and the delete, so both paths land on one message rather than two.
const TRANSFER_PENDING_MESSAGE =
  "This player has a transfer code waiting to be used. It has to be cancelled or used before you can delete them.";

/**
 * Editing an existing player. Same field set and validation as `AddPlayerSheet`
 * (`player-form.tsx`), reusing them because these are now the two real call sites for
 * that form. Differs from adding in three ways: it starts from the player's current
 * values instead of blank, it PATCHes only the fields that actually changed rather
 * than resending everything, and it has nothing to invalidate for an unchanged form —
 * see the no-op guard on submit below.
 *
 * Delete also lives here (#102) rather than a separate entry point — the iOS Contacts
 * convention of "edit is where you remove it too" keeps it off the courtside quick
 * paths (roster tap, home) entirely. Confirming swaps the sheet to a second step
 * rather than stacking an AlertDialog on top: both Sheet and AlertDialog portal to the
 * body and Base UI marks background content inert, so nesting one in the other is a
 * real risk the step swap avoids for free.
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
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("form");
  const [values, setValues] = useState<PlayerFormValues>(() => playerFormValuesFrom(player));
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const { uploadPhoto, removePhoto, uploadingPhoto, removingPhoto, photoErrorText } =
    usePlayerPhoto(player.id, () => setPickingPhoto(false));

  function reset() {
    // Back to the player's current values, not blank — this is the "ready for next
    // open" state, mirroring how AddPlayerSheet resets to BLANK_PLAYER_FORM on close.
    setStep("form");
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

  const { mutate: save, isPending: isSaving } = useMutation({
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

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      const { error: deleteError } = await deletePlayer({ path: { player_id: player.id } });
      if (deleteError) throw deleteError;
    },
    onSuccess: async () => {
      // The player is gone, so invalidating getPlayer would just refetch a 404 —
      // removing it drops the query outright. Deleting a player erases their matches
      // too, so the matches list is stale alongside the roster.
      queryClient.removeQueries({
        queryKey: getPlayerQueryKey({ path: { player_id: player.id } }),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: listMatchesQueryKey() }),
      ]);
      onOpenChange(false);
      await navigate({ to: "/players" });
    },
    onError: (mutationError) => {
      // Minting and cancelling a transfer code are #185's scope, not this sheet's —
      // so the 409 only explains the refusal, with nothing here to act on it.
      if (getErrorStatus(mutationError) === 409) {
        setStep("delete-blocked");
        return;
      }
      setError(parseErrorMessage(mutationError, "Could not delete that player."));
    },
  });

  return (
    <>
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
                <SheetTitle>Edit {player.first_name}</SheetTitle>
              </SheetHeader>

              <button
                type="button"
                onClick={() => setPickingPhoto(true)}
                aria-label={`Change ${player.first_name}'s photo`}
                className="self-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <PlayerAvatar player={player} size="lg" editable />
              </button>

              {photoErrorText && (
                <Alert variant="destructive">
                  <AlertDescription>{photoErrorText}</AlertDescription>
                </Alert>
              )}
              {(uploadingPhoto || removingPhoto) && (
                <p className="text-center text-sm text-muted-foreground" role="status">
                  {uploadingPhoto ? "Uploading…" : "Removing…"}
                </p>
              )}

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
                  save();
                }}
              >
                <PlayerFormFields values={values} onChange={update} showErrors={showErrors} />

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={isSaving} className="w-full">
                  {isSaving ? "Saving…" : "Save changes"}
                </Button>
              </form>

              <Separator />

              <Button
                type="button"
                variant="destructive"
                className="w-full"
                onClick={() => {
                  setError(null);
                  // Known ahead of time from the player's own record — no point showing
                  // the destructive confirm for a delete that's already going to refuse.
                  setStep(player.has_transfer_code ? "delete-blocked" : "confirm-delete");
                }}
              >
                Delete player
              </Button>
            </>
          ) : step === "confirm-delete" ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle>Delete {player.first_name}?</SheetTitle>
              </SheetHeader>

              <p className="text-sm text-muted-foreground">
                This deletes {player.first_name} {player.last_name} and every match recorded against
                them. This cannot be undone.
              </p>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                className="w-full"
                onClick={() => remove()}
              >
                {isDeleting ? "Deleting…" : "Delete player"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isDeleting}
                className="w-full"
                onClick={() => {
                  setError(null);
                  setStep("form");
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <SheetHeader className="p-0">
                <SheetTitle>Can't delete {player.first_name} yet</SheetTitle>
              </SheetHeader>

              <p className="text-sm text-muted-foreground">{TRANSFER_PENDING_MESSAGE}</p>

              <Button type="button" className="w-full" onClick={() => setStep("form")}>
                OK
              </Button>
            </>
          )}
        </SheetContent>
      </Sheet>

      <PhotoPickerSheet
        open={pickingPhoto}
        onOpenChange={setPickingPhoto}
        title={`${player.first_name}'s photo`}
        hasPhoto={player.photo_url !== null}
        onChoose={uploadPhoto}
        onRemove={removePhoto}
      />
    </>
  );
}
