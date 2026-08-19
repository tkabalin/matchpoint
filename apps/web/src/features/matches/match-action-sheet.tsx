import type { MatchRead } from "@matchpoint/api-client";
import { deleteMatch } from "@matchpoint/api-client";
import { listMatchesQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseErrorMessage } from "@/lib/parse-error";

import { SURFACE_LABEL, formatPlayedOn } from "./match-format";

type Step = "actions" | "confirm-delete";

/**
 * What a coach can do with one match, raised by tapping its row (#103). Delete is the
 * only action today — matches have no detail screen yet, so this sheet is where one
 * would eventually gain more (see the follow-up issue on designing that). Confirming
 * swaps the sheet's own content to a second step rather than nesting an AlertDialog
 * inside it, same reasoning as EditPlayerSheet's delete flow (#102): Sheet and
 * AlertDialog both portal to the body, and Base UI marking background content inert
 * makes nesting one in the other a real risk the step swap avoids for free.
 */
export function MatchActionSheet({
  match,
  open,
  onOpenChange,
}: {
  match: MatchRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("actions");
  const [error, setError] = useState<string | null>(null);

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      if (!match) return;
      const { error: deleteError } = await deleteMatch({ path: { match_id: match.id } });
      if (deleteError) throw deleteError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: listMatchesQueryKey() });
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not delete that match."));
    },
  });

  if (!match) return null;

  const opponent = match.opponent_name ?? "Unknown opponent";
  const detail = [formatPlayedOn(match.played_on), match.surface && SURFACE_LABEL[match.surface]]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setStep("actions");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        {step === "actions" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>{`vs ${opponent}`}</SheetTitle>
              <p className="text-sm text-muted-foreground">{detail}</p>
            </SheetHeader>

            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => setStep("confirm-delete")}
            >
              Delete match
            </Button>
            <SheetClose
              render={<Button variant="ghost" className="w-full text-muted-foreground" />}
            >
              Cancel
            </SheetClose>
          </>
        ) : (
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
              onClick={() => {
                setError(null);
                setStep("actions");
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
