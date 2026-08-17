import { createCoach, requestOtp, verifyOtp } from "@matchpoint/api-client";
import { Link, useNavigate } from "@tanstack/react-router";
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

type Step = "email" | "otp" | "password";

// Mirror the bounds the OpenAPI spec already publishes (CoachCreate.password,
// VerifyOtpRequest.otp) so an ordinary typo is blocked client-side instead of
// reaching the API as a 422 — one of which crashed the page outright (#51). The
// generated client types the request bodies themselves (#52), but not these numeric
// bounds — @hey-api emits no runtime validator, so this pair still needs to be kept in
// sync by hand if the spec's ever change.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const OTP_LENGTH = 6;

export function SignUp() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Neither request is safely repeatable, so the button is closed for the duration of
  // one rather than left open to an impatient second click: a second request-otp
  // replaces the code the first one emailed, and a second sign-up presents a cookie the
  // first already spent, which comes back as "Email not verified" for an account that
  // was in fact created.
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
  // email/displayName as zxcvbn's userInputs: it penalizes a password for containing
  // them, ahead of the backend's authoritative context-specific rejection.
  const passwordStrengthScore = useMemo(
    () => getPasswordStrengthScore(password, [email, displayName]),
    [password, email, displayName],
  );
  // Only checked once length already passes — no point telling someone a too-short or
  // too-long password is also guessable, and showing both at once collides on
  // `role="alert"`.
  const passwordTooWeak =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    passwordStrengthScore < PASSWORD_STRENGTH_MIN_SCORE;
  const canSubmitPassword =
    displayName !== "" &&
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
      const { error: requestOtpError, response } = await requestOtp({ body: { email } });

      if (response?.status === 202) {
        setStep("otp");
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // 409 (email already registered) — inline error, stay on the email step. This
      // fallback only fires when that detail isn't present (e.g. a network failure).
      setError(
        parseErrorMessage(
          requestOtpError,
          "We couldn't send you a verification code. Please try again.",
        ),
      );
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
      const { error: verifyOtpError, response } = await verifyOtp({ body: { email, otp } });

      if (response?.status === 200) {
        // No token to capture — the verification cookie the backend just set is
        // what POST /coaches (the next step) will present, not anything held here.
        setStep("password");
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // 400 (wrong/expired code) or 429 (too many attempts).
      setError(parseErrorMessage(verifyOtpError, "Could not verify that code."));
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
      const { error: createCoachError, response } = await createCoach({
        body: { email, password, display_name: displayName },
      });

      if (response?.status === 201) {
        // Sign in fresh with the new credentials, per the requested flow —
        // this doesn't land the coach on /home directly.
        await navigate({ to: "/" });
        return;
      }

      if (response?.status === 429) {
        setRetryAfterSeconds(getRetryAfterSeconds(response));
      }

      // 400/401 (missing or invalid OTP verification), 409 (duplicate email), or 429
      // (too many sign-up attempts).
      setError(parseErrorMessage(createCoachError, "Could not create the account."));
    } finally {
      setSubmitting(false);
    }
  }

  // Shared by the OTP step's "request a new one" and the password step's "start
  // over": both send the coach back to the email step, email preserved, without
  // auto-firing a new request-otp call — every request stays a deliberate click.
  function handleStartOver() {
    setStep("email");
    setOtp("");
    setDisplayName("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setRetryAfterSeconds(null);
  }

  if (step === "password") {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>
            <h1 className="text-center text-sm font-bold tracking-wide">Sign Up</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
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
              Sign Up
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
            <h1 className="text-center text-sm font-bold tracking-wide">Sign Up</h1>
          </CardTitle>
          <CardDescription className="text-center">We sent a code to {email}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleOtpSubmit}>
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
          <h1 className="text-center text-sm font-bold tracking-wide">Sign Up</h1>
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
