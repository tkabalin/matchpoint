import { getCurrentCoachOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import { useState } from "react";

import { AppPage } from "@/components/page-shell";
import { PhotoAvatar } from "@/components/photo-avatar";
import { PhotoPickerSheet } from "@/components/photo-picker-sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { initialsFor } from "@/lib/coach-initials";
import { useCoachPhoto } from "@/lib/use-coach-photo";
import { cn } from "@/lib/utils";

import { EditProfileSheet } from "./edit-profile-sheet";

export function Profile() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const [editingName, setEditingName] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const { uploadPhoto, removePhoto, uploadingPhoto, removingPhoto, photoErrorText } = useCoachPhoto(
    () => setPickingPhoto(false),
  );

  return (
    <AppPage nav={false} className="gap-0">
      {/* Bleeds past AppPage's own padding, then reapplies it — the shaded band spans
          the full width the way #178's hero treatment does. bg-muted rather than any
          brand or categorical color: this band carries no meaning of its own, and
          .claude/rules/web-color.md reserves every hex that does (constraint from the
          Profile/Settings wireframe review). */}
      <div className="-mx-4 -mt-4 flex flex-col items-center gap-3 border-b bg-muted px-4 pt-4 pb-8">
        <Link
          to="/home"
          aria-label="Back to home"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "self-start")}
        >
          <ArrowLeft />
        </Link>
        {coach && (
          <button
            type="button"
            onClick={() => setPickingPhoto(true)}
            aria-label="Change profile photo"
            className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <PhotoAvatar
              id={coach.id}
              initials={initialsFor(coach.display_name)}
              photoUrl={coach.photo_url}
              size="xl"
              shape="circle"
              editable
            />
          </button>
        )}
      </div>

      {photoErrorText && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{photoErrorText}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col items-center gap-1 pt-4 text-center">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-bold">{coach?.display_name}</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit display name"
            onClick={() => setEditingName(true)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
        {/* Never editable here or anywhere: CoachUpdate has no email field by design
            (constraint from the Profile/Settings wireframe review) — this is display
            only, not a stand-in for a change flow that doesn't exist. */}
        <p className="text-sm text-muted-foreground">{coach?.email}</p>
      </div>

      {coach && <EditProfileSheet coach={coach} open={editingName} onOpenChange={setEditingName} />}
      {coach && (
        <PhotoPickerSheet
          open={pickingPhoto}
          onOpenChange={setPickingPhoto}
          title="Profile photo"
          hasPhoto={coach.photo_url !== null}
          onChoose={uploadPhoto}
          onRemove={removePhoto}
        />
      )}
      {(uploadingPhoto || removingPhoto) && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {uploadingPhoto ? "Uploading…" : "Removing…"}
        </p>
      )}
    </AppPage>
  );
}
