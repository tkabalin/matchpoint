import { useState } from "react";
import type { FormEvent } from "react";

export function ForgotPassword() {
  const [email, setEmail] = useState("");

  const canSubmit = email !== "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No request yet — wired to POST /auth/forgot-password in a later issue (#66).
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Reset Password</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={!canSubmit}>
        Continue
      </button>
    </form>
  );
}
