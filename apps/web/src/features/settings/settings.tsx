import { changePassword, logout } from "@matchpoint/api-client";
import { getCurrentCoachOptions } from "@matchpoint/api-client/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PasswordInput } from "@/components/password-input";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";
import { useCountdown } from "@/lib/use-countdown";

type DialogStep = "closed" | "confirm" | "success";

// Mirrors the bounds the OpenAPI spec already publishes (ChangePasswordRequest.new_password),
// same as forgot-password's reset step — the current-password field has no minimum of its
// own, since it's checked against the existing hash rather than validated as a new one.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export function Settings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogStep, setDialogStep] = useState<DialogStep>("closed");
  // Already warm in the cache — #98's route guard fetches this before any protected
  // route renders — so this costs no extra round trip, just the email/display name
  // for zxcvbn's userInputs below. Disabled once signed out: handleConfirmSignOut's
  // queryClient.clear() wipes this from the cache while the change-password form (and
  // this query) is still mounted underneath the success dialog, which would otherwise
  // trigger a pointless refetch against a session that no longer exists.
  const { data: coach } = useQuery({
    ...getCurrentCoachOptions(),
    enabled: dialogStep !== "success",
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [incorrectPassword, setIncorrectPassword] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const changeErrorText =
    changeError && waiting ? `${changeError} Try again in ${retryCountdown}s.` : changeError;

  const newPasswordTooShort = newPassword !== "" && newPassword.length < PASSWORD_MIN_LENGTH;
  const newPasswordTooLong = newPassword.length > PASSWORD_MAX_LENGTH;
  const passwordsMismatch = confirmPassword !== "" && newPassword !== confirmPassword;
  const passwordStrengthScore = useMemo(
    () => getPasswordStrengthScore(newPassword, [coach?.email ?? "", coach?.display_name ?? ""]),
    [newPassword, coach?.email, coach?.display_name],
  );
  // Only checked once length already passes — no point telling someone a too-short or
  // too-long password is also guessable, and showing both at once collides on
  // `role="alert"`.
  const newPasswordTooWeak =
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    newPassword.length <= PASSWORD_MAX_LENGTH &&
    passwordStrengthScore < PASSWORD_STRENGTH_MIN_SCORE;
  const canSubmitChange =
    currentPassword !== "" &&
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    newPassword.length <= PASSWORD_MAX_LENGTH &&
    newPassword === confirmPassword &&
    passwordStrengthScore >= PASSWORD_STRENGTH_MIN_SCORE &&
    !waiting;

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIncorrectPassword(false);
    setSessionExpired(false);
    setChangeError(null);
    setRetryAfterSeconds(null);
    setChangeSuccess(false);
    setSubmitting(true);

    try {
      const { error, response } = await changePassword({
        body: { password: currentPassword, new_password: newPassword },
      });

      if (response?.status === 204) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setChangeSuccess(true);
        return;
      }

      // A 401 here means the session died between landing on this page and
      // submitting the form — #98's route guard only checks on navigation, not on
      // an in-flight mutation's response, so this needs its own fallback.
      if (response?.status === 401) {
        setSessionExpired(true);
        return;
      }

      if (response?.status === 403) {
        setIncorrectPassword(true);
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      setChangeError(parseErrorMessage(error, "Could not change your password."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmSignOut() {
    // Logout can't fail (always 204, cookie-present or not) — nothing to branch on.
    await logout();
    // Otherwise the next coach to sign in on this device would see the previous
    // coach's roster served straight from cache.
    queryClient.clear();
    setDialogStep("success");
  }

  async function handleAcknowledge() {
    setDialogStep("closed");
    await navigate({ to: "/" });
  }

  return (
    <div>
      <h1>Settings</h1>
      <Button variant="outline" onClick={() => setDialogStep("confirm")}>
        Sign Out
      </Button>

      <AlertDialog
        open={dialogStep === "confirm"}
        onOpenChange={(open) => !open && setDialogStep("closed")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to sign in again to access your players and matches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmSignOut}>
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialogStep === "success"} onOpenChange={() => undefined}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You've been signed out.</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleAcknowledge}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div>
        <h2>Change Password</h2>
        {sessionExpired ? (
          <Alert variant="destructive">
            <AlertDescription>
              Your session has expired. <Link to="/">Sign in</Link> again.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleChangePassword}>
            <label htmlFor="current-password">Current password</label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            {incorrectPassword && (
              <Alert variant="destructive">
                <AlertDescription>Incorrect password.</AlertDescription>
              </Alert>
            )}
            <label htmlFor="new-password">New password</label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {newPassword !== "" && <PasswordStrengthMeter score={passwordStrengthScore} />}
            <label htmlFor="confirm-new-password">Confirm new password</label>
            <PasswordInput
              id="confirm-new-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {newPasswordTooShort && (
              <Alert variant="destructive">
                <AlertDescription>Password must be at least 8 characters.</AlertDescription>
              </Alert>
            )}
            {newPasswordTooLong && (
              <Alert variant="destructive">
                <AlertDescription>Password must be at most 128 characters.</AlertDescription>
              </Alert>
            )}
            {newPasswordTooWeak && (
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
            {changeErrorText && (
              <Alert variant="destructive">
                <AlertDescription>{changeErrorText}</AlertDescription>
              </Alert>
            )}
            {changeSuccess && <p>Your password has been changed.</p>}
            <button type="submit" disabled={!canSubmitChange || submitting}>
              Change Password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
