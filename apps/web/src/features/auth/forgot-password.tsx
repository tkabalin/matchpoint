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
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "@/lib/password-strength";
import { useCountdown } from "@/lib/use-countdown";

import { AuthShell } from "./auth-shell";

type Step = "email" | "reset" | "done";

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
  // Neither submit is safely repeatable: a second forgot-password call replaces
  // the code the first one emailed, and a second run at the reset step burns
  // another attempt against the code's budget.
  const [submitting, setSubmitting] = useState(false);
  // verify-reset-code spends the code as it answers it, so a retry after the password
  // call failed must not send that code again: it would be refused as expired and cost
  // the coach a reset they typed correctly. The cookie it set is the proof from here on.
  const [codeVerified, setCodeVerified] = useState(false);
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
      // Two calls behind the one button: the code is answered first, which is what
      // mints the cookie reset-password reads. Splitting them across two screens is
      // the point of the API change, and its own issue.
      if (!codeVerified) {
        const { error: verifyError, response: verifyResponse } = await verifyResetCode({
          body: { email, otp },
        });

        if (verifyResponse?.status !== 200) {
          if (verifyResponse?.status === 429) {
            setRetryAfterSeconds(getRetryAfterSeconds(verifyResponse));
          }
          // 400 covers wrong code, expired code, unknown email, and attempt-budget-
          // exhausted alike: one message for all four, shown verbatim. 429 is "Too
          // many attempts".
          setError(parseErrorMessage(verifyError, "Could not verify that code."));
          return;
        }

        setCodeVerified(true);
      }

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

      // A 429 or an unreachable server leaves the verified code standing, so the button
      // simply retries. A 401 means the cookie is gone, and the code with it, so the only
      // way on is "Request a new one" below: re-answering a spent code cannot help. A 400
      // means the code was fine but the server's policy refused the new password, shown
      // verbatim so the reason is legible.
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
    setCodeVerified(false);
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

  if (step === "reset") {
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
          <form onSubmit={handleResetSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="otp">Code</FieldLabel>
                {/* Settled once the server has accepted it, because from then on the cookie
                    is the proof and this field no longer decides anything. Left editable, a
                    retry after a failed password call would silently ignore the new value
                    and reset the password on the old code's proof. */}
                <Input
                  id="otp"
                  type="text"
                  value={otp}
                  disabled={codeVerified}
                  onChange={(event) => setOtp(event.target.value)}
                />
              </Field>
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
            {otpWrongLength && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>Enter the 6-digit code.</AlertDescription>
              </Alert>
            )}
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
              disabled={!canSubmitReset || submitting}
              className="mt-5 w-full uppercase tracking-wide"
            >
              Reset Password
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex-col">
          <p className="text-center text-sm text-muted-foreground">
            Didn't get a code, or has it expired?{" "}
            <button
              type="button"
              onClick={handleStartOver}
              className="text-primary underline underline-offset-4"
            >
              Request a new one
            </button>
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
