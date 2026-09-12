import { changePlayerPassword, playerLogout } from "@matchpoint/api-client";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { PLAYER_TABS } from "@/components/nav-tabs";
import { PasswordInput } from "@/components/password-input";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { AppPage, PageHeader } from "@/components/page-shell";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { SignOutAction } from "@/features/settings/sign-out-action";
import { parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";

// Mirrors the bounds the OpenAPI spec already publishes (PlayerChangePasswordRequest.
// new_password) — see forgot-password.tsx's own copy of this comment for why these
// aren't read off the spec directly.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/**
 * A player's whole Settings tab: change the coach-issued password (#202/#203) and
 * sign out. No account/app/match-defaults categories — those are a coach's own
 * settings, not something a player has.
 */
export function PlayerSettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    passwordStrengthScore >= PASSWORD_STRENGTH_MIN_SCORE &&
    !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);

    try {
      const { error: changeError, response } = await changePlayerPassword({
        body: { password: currentPassword, new_password: password },
      });

      if (response?.status === 204) {
        setCurrentPassword("");
        setPassword("");
        setConfirmPassword("");
        setSuccess(true);
        return;
      }

      // 403 is the wrong current password, 400 is the new one failing the server's
      // policy, 401 means the session went away underneath the form — all three
      // are the server's own wording, shown verbatim rather than re-guessed here.
      setError(
        parseErrorMessage(
          changeError,
          response?.status === 401
            ? "Your session ended. Sign in again to change your password."
            : "Could not change your password.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppPage tabs={PLAYER_TABS}>
      <PageHeader title="Settings" />

      <StatCard title="Change password">
        <form onSubmit={handleSubmit}>
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
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>Password must be at least 8 characters.</AlertDescription>
            </Alert>
          )}
          {passwordTooLong && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>Password must be at most 128 characters.</AlertDescription>
            </Alert>
          )}
          {passwordTooWeak && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>
                This password is too easy to guess. Try something less predictable.
              </AlertDescription>
            </Alert>
          )}
          {passwordsMismatch && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>Passwords don't match.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert className="mt-3">
              <AlertDescription>Your password has been changed.</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={!canSubmit} className="mt-5 w-full">
            Change password
          </Button>
        </form>
      </StatCard>

      <Separator />

      <SignOutAction
        logoutFn={playerLogout}
        description="You'll need to sign in again to access your matches."
        trigger={(openConfirm) => (
          <Item render={<button type="button" onClick={openConfirm} />} className="justify-center">
            <ItemTitle className="font-bold">Sign Out</ItemTitle>
          </Item>
        )}
      />
    </AppPage>
  );
}
