import { useState } from "react";
import type { FormEvent } from "react";

export function SignUp() {
  const [email, setEmail] = useState("");

  const canSubmit = email !== "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No request yet — this is just the first step of the sign-up flow. A later
    // issue in the series (see #27) wires this up to the backend.
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign Up</h1>
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
