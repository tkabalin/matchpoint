import { changePassword, logout } from "@matchpoint/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
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
  const canSubmitChange =
    currentPassword !== "" &&
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    newPassword.length <= PASSWORD_MAX_LENGTH &&
    newPassword === confirmPassword &&
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
          <p role="alert">
            Your session has expired. <Link to="/">Sign in</Link> again.
          </p>
        ) : (
          <form onSubmit={handleChangePassword}>
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            {incorrectPassword && <p role="alert">Incorrect password.</p>}
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <label htmlFor="confirm-new-password">Confirm new password</label>
            <input
              id="confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {newPasswordTooShort && <p role="alert">Password must be at least 8 characters.</p>}
            {newPasswordTooLong && <p role="alert">Password must be at most 128 characters.</p>}
            {passwordsMismatch && <p role="alert">Passwords don't match.</p>}
            {changeErrorText && <p role="alert">{changeErrorText}</p>}
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
