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

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setError("Could not reach the server. Try again.");
      return;
    }

    if (response.ok) {
      await navigate({ to: "/home" });
      return;
    }

    // The backend deliberately returns the same message whether the email or the
    // password was wrong — shown verbatim, never re-worded per field. A 422 (e.g. an
    // empty body) is possible too, whose detail is an array rather than a string —
    // parseErrorMessage is what keeps that from crashing the page (#51).
    setError(await parseErrorMessage(response, "Could not sign in."));
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
    </div>
  );
}
