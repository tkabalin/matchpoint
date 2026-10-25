import { changePlayerPassword, playerLogout } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { AppPage, PageHeader } from "@/components/page-shell";
import { SectionLabel } from "@/components/section-label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { SignOutAction } from "@/features/settings/sign-out-action";
import { parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";

// Mirrors the bounds the OpenAPI spec already publishes (PlayerChangePasswordRequest.
// new_password) — see forgot-password.tsx's own copy of this comment for why these
// aren't read off the spec directly.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/**
 * A player's Account & Security, shaped like the coach's `settings-account.tsx`
 * but carrying only what a player actually has.
 *
 * Password stays an in-page current/new/confirm form rather than the coach's row
 * out to `/forgot-password`: that flow mails a one-time code, and a player's
 * account has no address of its own to mail. Sessions offers sign-out alone —
 * `DELETE /auth/sessions` takes a coach, so there is no revoke-everywhere for a
 * player to call. No danger zone either: deleting a player is the coach's action
 * on their own roster, not something a player does to themselves.
 */
export function PlayerSettingsAccount() {
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
    <AppPage nav={false}>
      <PageHeader
        title="Account & Security"
        back={
          <Link
            to="/me/settings"
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <SectionLabel id="player-account-password">Password</SectionLabel>
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

      <SectionLabel id="player-account-sessions">Sessions</SectionLabel>
      <ItemGroup aria-labelledby="player-account-sessions">
        <SignOutAction
          logoutFn={playerLogout}
          description="You'll need to sign in again to access your matches."
          trigger={(openConfirm) => (
            <Item variant="outline" render={<button type="button" onClick={openConfirm} />}>
              <ItemContent>
                <ItemTitle>Sign Out</ItemTitle>
              </ItemContent>
            </Item>
          )}
        />
      </ItemGroup>
    </AppPage>
  );
}
