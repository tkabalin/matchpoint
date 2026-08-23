import type { MatchRead } from "@matchpoint/api-client";
import { deleteMatch, releaseCapture } from "@matchpoint/api-client";
import { listMatchesQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getDeviceId } from "@/lib/device-id";
import { getErrorStatus } from "@/lib/error-status";
import { parseErrorMessage } from "@/lib/parse-error";
import { removeByMatch } from "@/features/outbox/outbox";

type Step = "confirm-delete" | "capture-conflict";

/**
 * Deleting one match, raised by tapping its row's own delete icon (#103,
 * #199) — the row also carries a separate edit icon, opening `EditMatchSheet`
 * directly, so this sheet's only job is delete-with-confirmation.
 *
 * A 409 on delete means another device holds the live capture claim (#213) —
 * offers a second step to release it and delete anyway, warning that any
 * points still queued on that other device need it reconnected before they
 * can land (same warning #197's takeover prompt carries).
 */
export function DeleteMatchSheet({
  match,
  open,
  onOpenChange,
}: {
  match: MatchRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("confirm-delete");
  const [error, setError] = useState<string | null>(null);

  async function finishDelete() {
    await queryClient.invalidateQueries({ queryKey: listMatchesQueryKey() });
    onOpenChange(false);
  }

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      if (!match) return;
      // Naming this device lets the server tell "someone else is capturing this" from
      // "you are", and only refuse the first. Backing out of capture leaves the claim
      // standing, so without it this phone would be refused its own half-set-up match.
      const { error: deleteError } = await deleteMatch({
        path: { match_id: match.id },
        query: { device_id: getDeviceId() },
      });
      if (deleteError) throw deleteError;
      // This device's own queued rows for the match it just deleted have to
      // go too, or the next drain re-posts them and puts the match back (#214).
      await removeByMatch(match.id);
    },
    onSuccess: finishDelete,
    onError: (mutationError) => {
      if (getErrorStatus(mutationError) === 409) {
        setStep("capture-conflict");
        return;
      }
      setError(parseErrorMessage(mutationError, "Could not delete that match."));
    },
  });

  const { mutate: releaseAndDelete, isPending: isReleasing } = useMutation({
    mutationFn: async () => {
      if (!match) return;
      const { error: releaseError } = await releaseCapture({ path: { match_id: match.id } });
      if (releaseError) throw releaseError;
      const { error: deleteError } = await deleteMatch({
        path: { match_id: match.id },
        query: { device_id: getDeviceId() },
      });
      if (deleteError) throw deleteError;
      await removeByMatch(match.id);
    },
    onSuccess: finishDelete,
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not delete that match."));
    },
  });

  if (!match) return null;

  const opponent = match.opponent_name ?? "Unknown opponent";
  const isBusy = isDeleting || isReleasing;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setStep("confirm-delete");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        {step === "confirm-delete" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>{`Delete this match?`}</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">
              This erases the match {`vs ${opponent}`} and everything recorded in it. This cannot be
              undone.
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
              {isDeleting ? "Deleting…" : "Delete match"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isDeleting}
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Being captured on another device</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">
              This match is being captured on another device right now. Releasing it and deleting
              anyway discards the match {`vs ${opponent}`} — any points still queued on that other
              device need it reconnected before they can land, and they'll be lost otherwise.
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              variant="destructive"
              disabled={isBusy}
              className="w-full"
              onClick={() => releaseAndDelete()}
            >
              {isReleasing ? "Releasing…" : "Release and delete anyway"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isBusy}
              className="w-full"
              onClick={() => {
                setError(null);
                setStep("confirm-delete");
              }}
            >
              Cancel
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
