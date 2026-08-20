import { deletePlayerPhoto, uploadPlayerPhoto } from "@matchpoint/api-client";
import { getPlayerQueryKey, listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { downscaleImage } from "@/lib/downscale-image";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { useCountdown } from "@/lib/use-countdown";

/**
 * Upload/remove a player's photo, for `EditPlayerSheet` (#192). Same shape as
 * `useCoachPhoto`, but invalidates rather than writes the cache directly — a photo
 * touches both the by-id query and the roster list, which `EditPlayerSheet`'s own
 * save/remove mutations already invalidate this same way, so this follows suit
 * rather than porting over Profile's single-key setQueryData shortcut.
 */
export function usePlayerPhoto(playerId: string, onSaved?: () => void) {
  const queryClient = useQueryClient();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const photoErrorText =
    photoError && waiting ? `${photoError} Try again in ${retryCountdown}s.` : photoError;

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getPlayerQueryKey({ path: { player_id: playerId } }),
      }),
      queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() }),
    ]);
  }

  const { mutate: uploadPhoto, isPending: uploadingPhoto } = useMutation({
    mutationFn: async (file: File) => {
      const downscaled = await downscaleImage(file);
      const { error, response } = await uploadPlayerPhoto({
        path: { player_id: playerId },
        body: { file: downscaled },
      });
      if (response?.status === 429) setRetryAfterSeconds(getRetryAfterSeconds(response));
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setPhotoError(null);
      onSaved?.();
    },
    onError: (mutationError) => {
      setPhotoError(parseErrorMessage(mutationError, "Could not upload that photo."));
    },
  });

  const { mutate: removePhoto, isPending: removingPhoto } = useMutation({
    mutationFn: async () => {
      const { error } = await deletePlayerPhoto({ path: { player_id: playerId } });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setPhotoError(null);
      onSaved?.();
    },
    onError: (mutationError) => {
      setPhotoError(parseErrorMessage(mutationError, "Could not remove that photo."));
    },
  });

  return {
    uploadPhoto,
    removePhoto,
    uploadingPhoto,
    removingPhoto,
    photoErrorText,
  };
}
