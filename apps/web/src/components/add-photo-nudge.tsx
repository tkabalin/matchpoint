import type { CoachRead } from "@matchpoint/api-client";
import { ImagePlus, X } from "lucide-react";
import { useState } from "react";

import { PhotoPickerSheet } from "@/components/photo-picker-sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { dismissPhotoReminder, hasDismissedPhotoReminder } from "@/lib/photo-reminder-dismissed";
import { useCoachPhoto } from "@/lib/use-coach-photo";

/**
 * A one-time nudge on Home for a coach who signed up without a photo (#179). Sign-up
 * itself can't offer this — `createCoach` sets no session, so there's nothing to
 * upload against yet — so the first real chance is here, the first screen reached
 * once one does exist. Hidden for good once dismissed, or once the coach has a photo.
 */
export function AddPhotoNudge({ coach }: { coach: CoachRead }) {
  const [dismissed, setDismissed] = useState(hasDismissedPhotoReminder);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const { uploadPhoto, uploadingPhoto, photoErrorText } = useCoachPhoto(() =>
    setPickingPhoto(false),
  );

  if (dismissed || coach.photo_url !== null) return null;

  return (
    <>
      <Item variant="outline">
        <ItemMedia>
          <ImagePlus className="size-4" aria-hidden="true" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Add a profile photo</ItemTitle>
          <ItemDescription>Helps players and other coaches recognize you.</ItemDescription>
        </ItemContent>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setPickingPhoto(true)}
            aria-label="Add a profile photo"
            className="text-xs font-semibold text-primary"
          >
            Add
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={() => {
              dismissPhotoReminder();
              setDismissed(true);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      </Item>

      {photoErrorText && (
        <Alert variant="destructive">
          <AlertDescription>{photoErrorText}</AlertDescription>
        </Alert>
      )}

      <PhotoPickerSheet
        open={pickingPhoto}
        onOpenChange={setPickingPhoto}
        title="Profile photo"
        hasPhoto={false}
        onChoose={uploadPhoto}
        onRemove={() => {}}
      />
      {uploadingPhoto && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          Uploading…
        </p>
      )}
    </>
  );
}
