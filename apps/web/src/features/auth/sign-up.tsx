import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

type Step = "email" | "otp" | "password";

export function SignUp() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmitEmail = email !== "";
  const canSubmitOtp = otp !== "";
  const passwordsMismatch = confirmPassword !== "" && password !== confirmPassword;
  const canSubmitPassword = password !== "" && password === confirmPassword;

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let response: Response;
    try {
      response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
    } catch {
      setError("Could not reach the server. Try again.");
      return;
    }

    if (response.status === 202) {
      setStep("otp");
      return;
    }

    // 409 (email already registered) — inline error, stay on the email step.
    const body = (await response.json()) as { detail?: string };
    setError(body.detail ?? "Could not request a code.");
  }

  function handleOtpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Verifying the code against the server is separate, later work (#45) —
    // for now, entering a code just advances to the password step locally.
    setStep("password");
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let response: Response;
    try {
      response = await fetch("/api/coaches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setError("Could not reach the server. Try again.");
      return;
    }

    if (response.status === 201) {
      // Sign in fresh with the new credentials, per the requested flow —
      // this doesn't land the coach on /home directly.
      await navigate({ to: "/" });
      return;
    }

    // 400/401 (missing or invalid OTP verification) or 409 (duplicate email).
    const body = (await response.json()) as { detail?: string };
    setError(body.detail ?? "Could not create the account.");
  }

  if (step === "password") {
    return (
      <form onSubmit={handlePasswordSubmit}>
        <h1>Sign Up</h1>
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
        {passwordsMismatch && <p role="alert">Passwords don't match.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmitPassword}>
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
        <button type="submit" disabled={!canSubmitOtp}>
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
      <button type="submit" disabled={!canSubmitEmail}>
        Continue
      </button>
    </form>
  );
}
