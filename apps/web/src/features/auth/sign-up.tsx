import { useState } from "react";
import type { FormEvent } from "react";

type Step = "email" | "otp";

export function SignUp() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmitEmail = email !== "";
  const canSubmitOtp = otp !== "";

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
    // Verifying the code is separate, later work (#45) — this step only
    // captures it locally for now, it doesn't call the server yet.
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
