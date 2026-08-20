import { createPlayer, uploadPlayerPhoto } from "@matchpoint/api-client";
import { listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PhotoAvatar } from "@/components/photo-avatar";
import { PhotoPickerSheet } from "@/components/photo-picker-sheet";
import { PlayerFormFields } from "@/components/player-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { downscaleImage } from "@/lib/downscale-image";
import { parseErrorMessage } from "@/lib/parse-error";
import { BLANK_PLAYER_FORM, type PlayerFormValues, validatePlayerForm } from "@/lib/player-form";

/**
 * Adding a player.
 *
 * Everything except notes is required. Player setup is done ahead of time rather
 * than courtside, so this is the one place a coach can be asked for the full record
 * — the speed constraint in the brief is about capturing points during a match, not
 * about this form.
 */
export function AddPlayerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<PlayerFormValues>(BLANK_PLAYER_FORM);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  // The player has no id until createPlayer resolves, so a picked photo is held
  // here rather than uploaded — PhotoPickerSheet's own doc comment anticipates
  // exactly this case (#192). The preview is the picked File's own object URL,
  // passed straight to PhotoAvatar's photoUrl like any other image source.
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState<string | null>(null);

  function setPendingPhotoFile(file: File | null) {
    setPendingPhotoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
    setPendingPhoto(file);
    setPickingPhoto(false);
  }

  function reset() {
    setValues(BLANK_PLAYER_FORM);
    setShowErrors(false);
    setError(null);
    setPendingPhotoFile(null);
  }

  function update<K extends keyof PlayerFormValues>(key: K, value: PlayerFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const { isValid } = validatePlayerForm(values);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { data, error: createError } = await createPlayer({
        body: {
          first_name: values.firstName.trim(),
          last_name: values.lastName.trim(),
          date_of_birth: values.dateOfBirth,
          // Narrowed by `isValid` before this runs, so the empty member is gone.
          gender: values.gender as Exclude<PlayerFormValues["gender"], "">,
          dominant_hand: values.hand,
          notes: values.notes.trim() === "" ? null : values.notes.trim(),
        },
      });
      if (createError) throw createError;
      // The player is created either way — a photo failure here (network blip, rate
      // limit) is silently dropped rather than undoing or blocking the add. The
      // coach can set it afterward from Edit player, which has the same picker.
      if (pendingPhoto) {
        try {
          const downscaled = await downscaleImage(pendingPhoto);
          await uploadPlayerPhoto({ path: { player_id: data.id }, body: { file: downscaled } });
        } catch {
          // Deliberately swallowed — see comment above.
        }
      }
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
          <SheetHeader className="p-0">
            <SheetTitle>Add a player</SheetTitle>
          </SheetHeader>

          <button
            type="button"
            onClick={() => setPickingPhoto(true)}
            aria-label="Add a player photo"
            className="self-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <PhotoAvatar
              id="new-player"
              initials={`${values.firstName[0] ?? ""}${values.lastName[0] ?? ""}`.toUpperCase()}
              photoUrl={pendingPhotoPreview}
              shape="square"
              size="lg"
              editable
            />
          </button>

          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              // Errors stay hidden until the first submit, so the form doesn't scold
              // the coach about fields they haven't reached yet.
              setShowErrors(true);
              if (isValid) mutate();
            }}
          >
            <PlayerFormFields values={values} onChange={update} showErrors={showErrors} />

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Adding…" : "Add player"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <PhotoPickerSheet
        open={pickingPhoto}
        onOpenChange={setPickingPhoto}
        title="Player photo"
        hasPhoto={pendingPhoto !== null}
        onChoose={setPendingPhotoFile}
        onRemove={() => setPendingPhotoFile(null)}
      />
    </>
  );
}
