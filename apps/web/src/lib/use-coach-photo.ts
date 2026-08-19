import { deleteCoachPhoto, uploadCoachPhoto } from "@matchpoint/api-client";
import { getCurrentCoachQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { downscaleImage } from "@/lib/downscale-image";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { useCountdown } from "@/lib/use-countdown";

/**
 * Upload/remove a coach's own profile photo, shared by Profile and Home's add-photo
 * nudge (#179) — both need the exact same downscale → upload → cache-write path, so
 * this is the one place it's written.
 *
 * Both endpoints answer with the whole coach, so the cache is written straight from
 * the response rather than invalidated — every reader of `getCurrentCoachOptions()`
 * (Home's greeting included) picks it up with no refetch.
 */
export function useCoachPhoto(onSaved?: () => void) {
  const queryClient = useQueryClient();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const photoErrorText =
    photoError && waiting ? `${photoError} Try again in ${retryCountdown}s.` : photoError;

  const { mutate: uploadPhoto, isPending: uploadingPhoto } = useMutation({
    mutationFn: async (file: File) => {
      const downscaled = await downscaleImage(file);
      const { data, error, response } = await uploadCoachPhoto({ body: { file: downscaled } });
      if (response?.status === 429) setRetryAfterSeconds(getRetryAfterSeconds(response));
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(getCurrentCoachQueryKey(), data);
      setPhotoError(null);
      onSaved?.();
    },
    onError: (mutationError) => {
      setPhotoError(parseErrorMessage(mutationError, "Could not upload that photo."));
    },
  });

  const { mutate: removePhoto, isPending: removingPhoto } = useMutation({
    mutationFn: async () => {
      const { data, error } = await deleteCoachPhoto();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(getCurrentCoachQueryKey(), data);
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
