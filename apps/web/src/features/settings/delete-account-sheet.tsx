import { deleteCurrentCoach } from "@matchpoint/api-client";
import { listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { purgeLocalData } from "@/lib/local-data";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { useCountdown } from "@/lib/use-countdown";

type Step = "warn-roster" | "password" | "final-warn" | "success";

const TRANSFER_CODE_MESSAGE =
  "Cancel the outstanding transfer code, or wait for it to be redeemed, before closing your account.";

/**
 * Closing an account (#184). Four steps rather than one confirm, per the severity —
 * this is the heaviest-consequence action in the app, so it gets the heaviest
 * friction (Fitts's Law's graduated-confirmation guidance).
 *
 * The first step already tells the coach every player goes with the account unless
 * moved first, so there's no separate "also delete my players" opt-in: reaching the
 * final step means they've already agreed to that, and the request always sends
 * `delete_players: true`. That also means the roster-non-empty 409 the backend can
 * return never actually applies here — only the non-waivable transfer-code one does.
 */
export function DeleteAccountSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("warn-roster");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [purgeFailed, setPurgeFailed] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const errorText = error && waiting ? `${error} Try again in ${retryCountdown}s.` : error;

  // Already fetched elsewhere (Home, Players) in the common case, so this is a cache
  // read, not a fresh request. Purely a heads-up: the backend's own check at submit
  // time is what actually decides, since this can go stale between the two.
  const { data: players } = useQuery(listPlayersOptions());
  const playersWithLiveCodes = (players ?? []).filter((player) => player.has_transfer_code);

  function reset() {
    setStep("warn-roster");
    setPassword("");
    setError(null);
    setRetryAfterSeconds(null);
    setPurgeFailed(false);
  }

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    setRetryAfterSeconds(null);
    try {
      const { error: deleteError, response } = await deleteCurrentCoach({
        body: { password, delete_players: true },
      });
      if (response?.status === 204) {
        try {
          await purgeLocalData(queryClient);
        } catch {
          setPurgeFailed(true);
        }
        setStep("success");
        return;
      }
      if (response?.status === 403) {
        setError(parseErrorMessage(deleteError, "Incorrect password."));
        setStep("password");
        return;
      }
      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
        setError(parseErrorMessage(deleteError, "Too many attempts."));
        return;
      }
      setError(parseErrorMessage(deleteError, "Could not delete your account."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryPurge() {
    try {
      await purgeLocalData(queryClient);
      setPurgeFailed(false);
    } catch {
      // Still blocked. Leave the dialog exactly as it was rather than re-stating the
      // same failure a second way.
    }
  }

  async function handleAcknowledge() {
    onOpenChange(false);
    reset();
    await navigate({ to: "/" });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && step !== "success") reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        {step === "warn-roster" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Deleting your account also deletes your players</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">
              Every player on your roster, and their entire match history, is deleted along with
              your account. If you want to keep a player, transfer them to another coach or delete
              them individually first.
            </p>

            {playersWithLiveCodes.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {playersWithLiveCodes.length === 1
                  ? `${playersWithLiveCodes[0]!.first_name} has an outstanding transfer code.`
                  : `${playersWithLiveCodes.length} players have an outstanding transfer code.`}{" "}
                {TRANSFER_CODE_MESSAGE}
              </p>
            )}

            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => setStep("password")}
            >
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : step === "password" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Confirm your password</SheetTitle>
            </SheetHeader>

            <Field>
              <FieldLabel htmlFor="delete-account-password">Password</FieldLabel>
              <PasswordInput
                id="delete-account-password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {errorText && (
              <Alert variant="destructive">
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              variant="destructive"
              disabled={password === "" || waiting}
              className="w-full"
              onClick={() => {
                setError(null);
                setStep("final-warn");
              }}
            >
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setStep("warn-roster")}
            >
              Back
            </Button>
          </>
        ) : step === "final-warn" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Delete your account?</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">
              This will permanently delete your account and every player. This cannot be undone.
            </p>

            {errorText && (
              <Alert variant="destructive">
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              variant="destructive"
              disabled={submitting || waiting}
              className="w-full"
              onClick={handleDelete}
            >
              {submitting ? "Deleting…" : "Delete account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Your account has been deleted.</SheetTitle>
            </SheetHeader>

            {purgeFailed && (
              <p className="text-sm text-muted-foreground">
                Some of your data could not be cleared from this device.
              </p>
            )}

            <Button type="button" className="w-full" onClick={handleAcknowledge}>
              OK
            </Button>
            {purgeFailed && (
              <Button type="button" variant="outline" className="w-full" onClick={handleRetryPurge}>
                Retry clearing this device
              </Button>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
