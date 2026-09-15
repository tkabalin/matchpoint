import { forgotPassword, resetPassword, verifyResetCode } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { PasswordInput } from "@/components/password-input";
import { PasswordStrengthMeter } from "@/components/password-strength-meter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";
import { useCountdown } from "@/lib/use-countdown";

import { AuthShell } from "./auth-shell";

// Mirrors sign-up's own step shape (email / otp / password), which this now matches
// rather than combining verification and reset on one screen (#150).
type Step = "email" | "otp" | "password" | "done";

// Mirror the bounds the OpenAPI spec already publishes (VerifyResetCodeRequest.otp,
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
  // Neither request is safely repeatable, so the button is closed for the duration of
  // one rather than left open to an impatient second click: a second forgot-password
  // call replaces the code the first one emailed, and a second verify-reset-code burns
  // another attempt against the code's budget.
  const [submitting, setSubmitting] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;
  const errorText = error && waiting ? `${error} Try again in ${retryCountdown}s.` : error;

  const canSubmitEmail = email !== "" && !waiting;
  const canSubmitOtp = otp.length === OTP_LENGTH && !waiting;
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
  const canSubmitPassword =
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
        setStep("otp");
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

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRetryAfterSeconds(null);
    setSubmitting(true);

    try {
      const { error: verifyError, response } = await verifyResetCode({ body: { email, otp } });

      if (response?.status === 200) {
        // No token to capture — the verification cookie the backend just set is what
        // reset-password (the next step) will present, not anything held here.
        setStep("password");
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // 400 covers wrong code, expired code, unknown email, and attempt-budget-exhausted
      // alike: one message for all four, shown verbatim. 429 is "Too many attempts".
      setError(parseErrorMessage(verifyError, "Could not verify that code."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRetryAfterSeconds(null);
    setSubmitting(true);

    try {
      const { error: resetPasswordError, response } = await resetPassword({
        body: { email, new_password: password },
      });

      if (response?.status === 204) {
        setStep("done");
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // A 429 or an unreachable server leaves the verified cookie standing, so the
      // button simply retries. A 401 means the cookie is gone, so the only way on is
      // "Start over" below: the code screen has nothing left to re-answer. A 400 means
      // the code was fine but the server's policy refused the new password, shown
      // verbatim so the reason is legible.
      setError(parseErrorMessage(resetPasswordError, "Could not reset your password."));
    } finally {
      setSubmitting(false);
    }
  }

  // Shared by the OTP step's and the password step's "start over": both send the
  // coach back to the email step, email preserved, without auto-firing a new
  // forgot-password call — every request stays a deliberate click.
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
        <CardHeader>
          <CardTitle>
            <h1 className="text-center text-2xl tracking-wide">Reset Password</h1>
          </CardTitle>
          <CardDescription className="text-center">Your password has been updated.</CardDescription>
        </CardHeader>
        <CardFooter className="flex-col">
          <p className="text-center text-sm">
            <Link to="/" className="text-primary underline underline-offset-4">
              Sign in
            </Link>{" "}
            with your new password.
          </p>
        </CardFooter>
      </AuthShell>
    );
  }

  if (step === "password") {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>
            <h1 className="text-center text-2xl tracking-wide">Reset Password</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="password">New password</FieldLabel>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {password !== "" && <PasswordStrengthMeter score={passwordStrengthScore} />}
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
                <PasswordInput
                  id="confirm-password"
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
            {errorText && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              disabled={!canSubmitPassword || submitting}
              className="mt-5 w-full uppercase tracking-wide"
            >
              Reset Password
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex-col">
          <p className="text-center text-sm">
            <button
              type="button"
              onClick={handleStartOver}
              className="text-primary underline underline-offset-4"
            >
              Start over
            </button>
          </p>
        </CardFooter>
      </AuthShell>
    );
  }

  if (step === "otp") {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>
            <h1 className="text-center text-2xl tracking-wide">Reset Password</h1>
          </CardTitle>
          {/* forgot-password answers every address alike (202 whether or not it's
              registered), unlike sign-up's request-otp, so this can't claim the
              account exists the way sign-up's OTP step does. */}
          <CardDescription className="text-center">
            If an account exists for {email}, we've sent it a code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleOtpSubmit}>
            <FieldGroup>
              <Field className="items-center">
                <FieldLabel htmlFor="otp">Code</FieldLabel>
                {/* onComplete is deliberately left unwired — the explicit Verify button
                    below stays the only way to submit (#148). */}
                <InputOTP id="otp" maxLength={OTP_LENGTH} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </Field>
            </FieldGroup>
            {otpWrongLength && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>Enter the 6-digit code.</AlertDescription>
              </Alert>
            )}
            {errorText && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{errorText}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              disabled={!canSubmitOtp || submitting}
              className="mt-5 w-full uppercase tracking-wide"
            >
              Verify
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <p className="text-center text-sm text-muted-foreground">
            Wrong email, no code, or has it expired?
          </p>
          <button
            type="button"
            onClick={handleStartOver}
            className="text-sm text-primary underline underline-offset-4"
          >
            Start over
          </button>
          <p className="text-center text-sm">
            <Link to="/" className="text-primary underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>
          <h1 className="text-center text-2xl tracking-wide">Reset Password</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleEmailSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {errorText && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          )}
          <Button
            type="submit"
            disabled={!canSubmitEmail || submitting}
            className="mt-5 w-full uppercase tracking-wide"
          >
            Continue
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col">
        <p className="text-center text-sm">
          <Link to="/" className="text-primary underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </CardFooter>
    </AuthShell>
  );
}
