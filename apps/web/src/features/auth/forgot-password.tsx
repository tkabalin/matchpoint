import { forgotPassword } from "@matchpoint/api-client";
import { useState } from "react";
import type { FormEvent } from "react";

import { parseErrorMessage } from "./parse-error";

type Step = "email" | "reset";

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

  const canSubmitEmail = email !== "";
  const otpWrongLength = otp !== "" && otp.length !== OTP_LENGTH;
  const passwordsMismatch = confirmPassword !== "" && password !== confirmPassword;
  const passwordTooShort = password !== "" && password.length < PASSWORD_MIN_LENGTH;
  const passwordTooLong = password.length > PASSWORD_MAX_LENGTH;
  const canSubmitReset =
    otp.length === OTP_LENGTH &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    password === confirmPassword;

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: forgotPasswordError, response } = await forgotPassword({ body: { email } });

      if (response?.status === 202) {
        setStep("reset");
        return;
      }

      // 429 (too many codes requested) or 502 (couldn't send that code).
      setError(parseErrorMessage(forgotPasswordError, "Could not request a code."));
    } finally {
      setSubmitting(false);
    }
  }

  function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No request yet — wired to POST /auth/reset-password in a later issue (#67).
  }

  if (step === "reset") {
    return (
      <form onSubmit={handleResetSubmit}>
        <h1>Reset Password</h1>
        {/* forgot-password answers every address alike (202 whether or not it's
            registered), unlike sign-up's request-otp, so this can't claim the
            account exists the way sign-up's OTP step does. */}
        <p>If an account exists for {email}, we've sent it a code.</p>
        <label htmlFor="otp">Code</label>
        <input id="otp" type="text" value={otp} onChange={(event) => setOtp(event.target.value)} />
        {otpWrongLength && <p role="alert">Enter the 6-digit code.</p>}
        <label htmlFor="password">New password</label>
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
        {passwordTooLong && <p role="alert">Password must be at most 128 characters.</p>}
        {passwordsMismatch && <p role="alert">Passwords don't match.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmitReset || submitting}>
          Reset Password
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleEmailSubmit}>
      <h1>Reset Password</h1>
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
