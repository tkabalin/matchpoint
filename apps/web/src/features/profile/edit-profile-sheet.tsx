import { updateCurrentCoach } from "@matchpoint/api-client";
import type { CoachRead } from "@matchpoint/api-client";
import { getCurrentCoachQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { useCountdown } from "@/lib/use-countdown";

// Mirrors zCoachUpdate's bound on display_name (@matchpoint/api-client/zod) — the
// generated client types the field as a plain string, so this is the same
// hand-mirroring caveat every other form in the app already carries.
const DISPLAY_NAME_MAX = 100;

export function EditProfileSheet({
  coach,
  open,
  onOpenChange,
}: {
  coach: CoachRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(coach.display_name);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const errorText = error && waiting ? `${error} Try again in ${retryCountdown}s.` : error;

  const trimmed = displayName.trim();
  const isValid = trimmed !== "" && trimmed.length <= DISPLAY_NAME_MAX;
  const unchanged = trimmed === coach.display_name;

  function reset() {
    setDisplayName(coach.display_name);
    setShowErrors(false);
    setError(null);
    setRetryAfterSeconds(null);
  }

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const {
        data,
        error: updateError,
        response,
      } = await updateCurrentCoach({
        body: { display_name: trimmed },
      });
      if (response?.status === 429) setRetryAfterSeconds(getRetryAfterSeconds(response));
      if (updateError) throw updateError;
      return data;
    },
    onSuccess: (data) => {
      // Written straight into the cache rather than invalidated: the response is
      // already the coach's new record, and Home reads this same query key, so its
      // greeting updates with it — no refetch, no manual refresh (#179).
      queryClient.setQueryData(getCurrentCoachQueryKey(), data);
      reset();
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not save that name."));
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
          <SheetTitle>Edit name</SheetTitle>
        </SheetHeader>

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setShowErrors(true);
            if (!isValid) return;
            // Same reasoning as EditPlayerSheet: nothing changed means the correct
            // response to Save is closing, not a PATCH with the same value.
            if (unchanged) {
              onOpenChange(false);
              return;
            }
            mutate();
          }}
        >
          <FieldGroup>
            <Field data-invalid={showErrors && trimmed === "" ? true : undefined}>
              <FieldLabel htmlFor="display-name">Display name</FieldLabel>
              <Input
                id="display-name"
                maxLength={DISPLAY_NAME_MAX}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              {showErrors && trimmed === "" && <FieldError>Display name is required.</FieldError>}
            </Field>
          </FieldGroup>

          {errorText && (
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
