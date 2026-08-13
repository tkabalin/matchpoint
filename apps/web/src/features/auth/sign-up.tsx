import { createCoach, requestOtp, verifyOtp } from "@matchpoint/api-client";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { parseErrorMessage } from "./parse-error";

type Step = "email" | "otp" | "password";

// Mirror the bounds the OpenAPI spec already publishes (CoachCreate.password,
// VerifyOtpRequest.otp) so an ordinary typo is blocked client-side instead of
// reaching the API as a 422 — one of which crashed the page outright (#51). The
// generated client types the request bodies themselves (#52), but not these numeric
// bounds — @hey-api emits no runtime validator, so this pair still needs to be kept in
// sync by hand if the spec's ever change.
const PASSWORD_MIN_LENGTH = 8;
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

  const canSubmitEmail = email !== "";
  const canSubmitOtp = otp.length === OTP_LENGTH;
  const otpWrongLength = otp !== "" && otp.length !== OTP_LENGTH;
  const passwordsMismatch = confirmPassword !== "" && password !== confirmPassword;
  const passwordTooShort = password !== "" && password.length < PASSWORD_MIN_LENGTH;
  const canSubmitPassword =
    displayName !== "" && password.length >= PASSWORD_MIN_LENGTH && password === confirmPassword;

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: requestOtpError, response } = await requestOtp({ body: { email } });

      if (response?.status === 202) {
        setStep("otp");
        return;
      }

      // 409 (email already registered) — inline error, stay on the email step.
      setError(parseErrorMessage(requestOtpError, "Could not request a code."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: verifyOtpError, response } = await verifyOtp({ body: { email, otp } });

      if (response?.status === 200) {
        // No token to capture — the verification cookie the backend just set is
        // what POST /coaches (the next step) will present, not anything held here.
        setStep("password");
        return;
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

      // 400/401 (missing or invalid OTP verification) or 409 (duplicate email).
      setError(parseErrorMessage(createCoachError, "Could not create the account."));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "password") {
    return (
      <form onSubmit={handlePasswordSubmit}>
        <h1>Sign Up</h1>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        {passwordTooShort && <p role="alert">Password must be at least 8 characters.</p>}
        {passwordsMismatch && <p role="alert">Passwords don't match.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmitPassword || submitting}>
          Sign Up
        </button>
      </form>
    );
  }

  if (step === "otp") {
    return (
      <form onSubmit={handleOtpSubmit}>
        <h1>Sign Up</h1>
        <p>We sent a code to {email}.</p>
        <label htmlFor="otp">Code</label>
        <input id="otp" type="text" value={otp} onChange={(event) => setOtp(event.target.value)} />
        {otpWrongLength && <p role="alert">Enter the 6-digit code.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmitOtp || submitting}>
          Verify
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleEmailSubmit}>
      <h1>Sign Up</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!canSubmitEmail || submitting}>
        Continue
      </button>
    </form>
  );
}
