import { forgotPassword, resetPassword } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";
import { useCountdown } from "@/lib/use-countdown";

import { AuthShell } from "./auth-shell";

type Step = "email" | "reset" | "done";

// Mirror the bounds the OpenAPI spec already publishes (ResetPasswordRequest.otp,
// ResetPasswordRequest.new_password) so an ordinary typo is blocked client-side
// instead of reaching the API as a 422 — the generated client types the request
// body itself, but not these numeric bounds, since @hey-api emits no runtime
// validator.
const OTP_LENGTH = 6;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export function ForgotPassword() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Neither request is safely repeatable: a second forgot-password call replaces
  // the code the first one emailed, and a second reset-password call burns
  // another attempt against the same budget.
  const [submitting, setSubmitting] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const errorText = error && waiting ? `${error} Try again in ${retryCountdown}s.` : error;

  const canSubmitEmail = email !== "" && !waiting;
  const otpWrongLength = otp !== "" && otp.length !== OTP_LENGTH;
  const passwordsMismatch = confirmPassword !== "" && password !== confirmPassword;
  const passwordTooShort = password !== "" && password.length < PASSWORD_MIN_LENGTH;
  const passwordTooLong = password.length > PASSWORD_MAX_LENGTH;
  // Only email as zxcvbn's userInputs here — this flow has no display name to give it.
  const passwordStrengthScore = useMemo(
    () => getPasswordStrengthScore(password, [email]),
    [password, email],
  );
  // Only checked once length already passes — no point telling someone a too-short or
  // too-long password is also guessable, and showing both at once collides on
  // `role="alert"`.
  const passwordTooWeak =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    passwordStrengthScore < PASSWORD_STRENGTH_MIN_SCORE;
  const canSubmitReset =
    otp.length === OTP_LENGTH &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    password === confirmPassword &&
    passwordStrengthScore >= PASSWORD_STRENGTH_MIN_SCORE &&
    !waiting;

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRetryAfterSeconds(null);
    setSubmitting(true);

    try {
      const { error: forgotPasswordError, response } = await forgotPassword({ body: { email } });

      if (response?.status === 202) {
        setStep("reset");
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // 429 (too many codes requested) or 502 (couldn't send that code).
      setError(parseErrorMessage(forgotPasswordError, "Could not request a code."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRetryAfterSeconds(null);
    setSubmitting(true);

    try {
      const { error: resetPasswordError, response } = await resetPassword({
        body: { email, otp, new_password: password },
      });

      if (response?.status === 204) {
        setStep("done");
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // 400 covers wrong code, expired code, unknown email, and attempt-budget-
      // exhausted alike — one message for all four, shown verbatim. 429 is "Too
      // many attempts".
      setError(parseErrorMessage(resetPasswordError, "Could not reset your password."));
    } finally {
      setSubmitting(false);
    }
  }

  function handleStartOver() {
    setStep("email");
    setOtp("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setRetryAfterSeconds(null);
  }

  if (step === "done") {
    return (
      <AuthShell>
        <h1 className="mb-2 text-center text-sm font-bold tracking-wide">Reset Password</h1>
        <p className="text-center text-sm text-muted-foreground">Your password has been updated.</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/" className="text-primary underline underline-offset-4">
            Sign in
          </Link>{" "}
          with your new password.
        </p>
      </AuthShell>
    );
  }

  if (step === "reset") {
    return (
      <AuthShell>
        <form onSubmit={handleResetSubmit}>
          <h1 className="mb-2 text-center text-sm font-bold tracking-wide">Reset Password</h1>
          {/* forgot-password answers every address alike (202 whether or not it's
              registered), unlike sign-up's request-otp, so this can't claim the
              account exists the way sign-up's OTP step does. */}
          <p className="mb-5 text-center text-sm text-muted-foreground">
            If an account exists for {email}, we've sent it a code.
          </p>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="otp">Code</FieldLabel>
              <Input
                id="otp"
                type="text"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <PasswordInput
                id="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {password !== "" && <PasswordStrengthMeter score={passwordStrengthScore} />}
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
              <PasswordInput
                id="confirm-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {otpWrongLength && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Enter the 6-digit code.
            </p>
          )}
          {passwordTooShort && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Password must be at least 8 characters.
            </p>
          )}
          {passwordTooLong && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Password must be at most 128 characters.
            </p>
          )}
          {passwordTooWeak && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              This password is too easy to guess. Try something less predictable.
            </p>
          )}
          {passwordsMismatch && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Passwords don't match.
            </p>
          )}
          {errorText && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {errorText}
            </p>
          )}
          <Button
            type="submit"
            disabled={!canSubmitReset || submitting}
            className="mt-5 w-full uppercase tracking-wide"
          >
            Reset Password
          </Button>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Didn't get a code, or has it expired?{" "}
            <button
              type="button"
              onClick={handleStartOver}
              className="text-primary underline underline-offset-4"
            >
              Request a new one
            </button>
          </p>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleEmailSubmit}>
        <h1 className="mb-5 text-center text-sm font-bold tracking-wide">Reset Password</h1>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
        </FieldGroup>
        {errorText && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {errorText}
          </p>
        )}
        <Button
          type="submit"
          disabled={!canSubmitEmail || submitting}
          className="mt-5 w-full uppercase tracking-wide"
        >
          Continue
        </Button>
        <p className="mt-4 text-center text-sm">
          <Link to="/" className="text-primary underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
