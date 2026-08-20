import type { PlayerRead } from "@matchpoint/api-client";
import { redeemPlayerTransferCode } from "@matchpoint/api-client";
import { listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { useCountdown } from "@/lib/use-countdown";
import { cn } from "@/lib/utils";

// Mirrors RedeemTransferCodeRequest.code's maxLength (@matchpoint/api-client/zod) — the
// generated client types the field as a plain string, same hand-mirroring caveat every
// other form in the app already carries.
const CODE_MAX = 100;

type Step = "form" | "success";

/**
 * Redeeming a code another coach handed over out-of-band (#185). Lives on `PlayersPage`
 * rather than per-player, since redeeming happens before the player is on this
 * coach's roster at all — the roster-level counterpart to `AddPlayerSheet`.
 */
export function RedeemTransferCodeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("form");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [transferredPlayer, setTransferredPlayer] = useState<PlayerRead | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const errorText = error && waiting ? `${error} Try again in ${retryCountdown}s.` : error;

  function reset() {
    setStep("form");
    setCode("");
    setError(null);
    setRetryAfterSeconds(null);
    setTransferredPlayer(null);
  }

  const trimmed = code.trim();

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const {
        data,
        error: redeemError,
        response,
      } = await redeemPlayerTransferCode({
        body: { code: trimmed },
      });
      if (response?.status === 429) setRetryAfterSeconds(getRetryAfterSeconds(response));
      if (redeemError) throw redeemError;
      return data;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });
      setError(null);
      setTransferredPlayer(data);
      setStep("success");
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not redeem that code."));
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
        {step === "form" ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>Redeem a transfer code</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">
              Enter the code another coach gave you to add their player, with match history, to your
              roster.
            </p>

            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                if (trimmed !== "") mutate();
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="transfer-code">Code</FieldLabel>
                  <Input
                    id="transfer-code"
                    autoComplete="off"
                    maxLength={CODE_MAX}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </Field>
              </FieldGroup>

              {errorText && (
                <Alert variant="destructive">
                  <AlertDescription>{errorText}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={isPending || trimmed === "" || waiting}
                className="w-full"
              >
                {isPending ? "Redeeming…" : "Redeem"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>{transferredPlayer?.first_name} added to your roster</SheetTitle>
            </SheetHeader>

            <p className="text-sm text-muted-foreground">Their match history came with them.</p>

            {transferredPlayer && (
              <Link
                to="/players/$playerId"
                params={{ playerId: transferredPlayer.id }}
                onClick={() => onOpenChange(false)}
                className={cn(buttonVariants(), "w-full")}
              >
                View player
              </Link>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
