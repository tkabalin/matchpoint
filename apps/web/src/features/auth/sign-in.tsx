import { login } from "@matchpoint/api-client";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { parseErrorMessage } from "./parse-error";

export function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email !== "" && password !== "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const { error: loginError, response } = await login({ body: { email, password } });

    if (response?.status === 200) {
      await navigate({ to: "/home" });
      return;
    }

    // The backend deliberately returns the same message whether the email or the
    // password was wrong — shown verbatim, never re-worded per field. This fallback
    // only fires when that detail isn't present (e.g. a network failure).
    setError(
      parseErrorMessage(
        loginError,
        "We couldn't sign you in. Check your email and password and try again.",
      ),
    );
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <h1>Sign In</h1>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSubmit}>
          Sign In
        </button>
      </form>
      <p>
        If you don't have an account, <Link to="/sign-up">sign up here</Link>.
      </p>
      <p>
        Forgot your password? <Link to="/forgot-password">Reset it here</Link>.
      </p>
    </div>
  );
}
