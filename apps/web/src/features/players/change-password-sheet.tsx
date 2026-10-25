import { changePlayerPassword } from "@matchpoint/api-client";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";

// Mirrors the bounds the OpenAPI spec already publishes (PlayerChangePasswordRequest.
// new_password) — see forgot-password.tsx's own copy of this comment for why these
// aren't read off the spec directly.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/**
 * A player's change-password form, opened from its own row on Account &
 * Security rather than sitting inline on the page permanently (#300) —
 * Hick's Law: a settings screen a player visits mainly to sign out or check
 * what's there shouldn't default to showing a password form nobody asked
 * for yet. Same `Sheet` pattern `EditProfileSheet` and `note-button.tsx`
 * already use for a short form that closes itself on success; the closing
 * sheet is the thing that makes `toast.success` the right confirmation here
 * rather than an inline message, which would have nowhere left to sit.
 */
export function ChangePasswordSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const passwordsMismatch = confirmPassword !== "" && password !== confirmPassword;
  const passwordTooShort = password !== "" && password.length < PASSWORD_MIN_LENGTH;
  const passwordTooLong = password.length > PASSWORD_MAX_LENGTH;
  const passwordStrengthScore = useMemo(() => getPasswordStrengthScore(password), [password]);
  const passwordTooWeak =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    passwordStrengthScore < PASSWORD_STRENGTH_MIN_SCORE;
  const canSubmit =
    currentPassword !== "" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    password === confirmPassword &&
    passwordStrengthScore >= PASSWORD_STRENGTH_MIN_SCORE;

  function reset() {
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
  }

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { error: changeError, response } = await changePlayerPassword({
        body: { password: currentPassword, new_password: password },
      });
      if (response?.status !== 204) {
        // 403 is the wrong current password, 400 is the new one failing the
        // server's policy, 401 means the session went away underneath the
        // form — all three are the server's own wording, shown verbatim
        // rather than re-guessed here.
        throw new Error(
          parseErrorMessage(
            changeError,
            response?.status === 401
              ? "Your session ended. Sign in again to change your password."
              : "Could not change your password.",
          ),
        );
      }
    },
    onSuccess: () => {
      reset();
      onOpenChange(false);
      toast.success("Password changed");
    },
    onError: (mutationError) => {
      setError(mutationError.message);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!canSubmit) return;
    mutate();
  }

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
          <SheetTitle>Change password</SheetTitle>
        </SheetHeader>

        <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {password !== "" && <PasswordStrengthMeter score={passwordStrengthScore} />}
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-new-password">Confirm new password</FieldLabel>
              <PasswordInput
                id="confirm-new-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {passwordTooShort && (
            <Alert variant="destructive">
              <AlertDescription>Password must be at least 8 characters.</AlertDescription>
            </Alert>
          )}
          {passwordTooLong && (
            <Alert variant="destructive">
              <AlertDescription>Password must be at most 128 characters.</AlertDescription>
            </Alert>
          )}
          {passwordTooWeak && (
            <Alert variant="destructive">
              <AlertDescription>
                This password is too easy to guess. Try something less predictable.
              </AlertDescription>
            </Alert>
          )}
          {passwordsMismatch && (
            <Alert variant="destructive">
              <AlertDescription>Passwords don't match.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={!canSubmit || isPending} className="w-full">
            {isPending ? "Saving…" : "Change password"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
