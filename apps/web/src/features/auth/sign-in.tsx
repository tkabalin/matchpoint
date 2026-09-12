import { login, logout, playerLogin, playerLogout } from "@matchpoint/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { purgeIfOwnerChanged } from "@/lib/local-data";
import type { OwnerKind } from "@/lib/local-data";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";
import { useCountdown } from "@/lib/use-countdown";

import { AuthShell } from "./auth-shell";

export function SignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const retryCountdown = useCountdown(retryAfterSeconds);
  const waiting = retryCountdown !== null && retryCountdown > 0;

  const canSubmit = identifier !== "" && password !== "" && !waiting;
  const errorText = error && waiting ? `${error} Try again in ${retryCountdown}s.` : error;

  /**
   * The device-ownership handoff both sign-ins share: purge if this id isn't who the
   * device already belonged to, then land on the principal's own home. Awaited before
   * the navigation, so a device that was someone else's is wiped before the first
   * protected screen can render anything of theirs (#117). `kind` is recorded
   * alongside the id so `/`'s own guard can guess the right destination offline,
   * before either `_authenticated.tsx` or `_player.tsx` has a chance to confirm
   * anything over the network.
   */
  async function finishSignIn(principalId: string, kind: OwnerKind, target: "/home" | "/me") {
    try {
      await purgeIfOwnerChanged(principalId, queryClient, kind);
    } catch {
      // Failing closed. Navigating on a device that still holds the previous
      // owner's data is the one outcome worse than refusing to navigate at all.
      setError(
        "We couldn't clear this device before signing you in. Close any other MatchPoint tabs and try again.",
      );
      return;
    }
    await navigate({ to: target });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRetryAfterSeconds(null);

    // Routes by what was typed, not a "coach or player" choice up front: a coach's
    // identifier is always an email, a player's is always a server-generated username
    // with no "@" in it, so the two can never collide. This is the shape the backend
    // itself expects (#203) — POST /auth/login for one, POST /auth/player/login for
    // the other.
    if (identifier.includes("@")) {
      const {
        data: coach,
        error: loginError,
        response,
      } = await login({
        body: { email: identifier, password },
      });

      if (response?.status === 200) {
        // A 200 nothing could be parsed out of leaves a session no one can attribute,
        // so the purge has nothing to key on. End it: otherwise a reload of a
        // protected route walks in on the previous owner's restored cache (#117).
        if (!coach) {
          await logout();
          setError("We signed you in but couldn't tell who you are. Please try again.");
          return;
        }
        await finishSignIn(coach.id, "coach", "/home");
        return;
      }

      if (response?.status === 429) setRetryAfterSeconds(getRetryAfterSeconds(response));
      // The backend deliberately returns the same message whether the email or the
      // password was wrong — shown verbatim, never re-worded per field. This
      // fallback only fires when that detail isn't present (e.g. a network failure).
      setError(
        parseErrorMessage(
          loginError,
          "We couldn't sign you in. Check your email and password and try again.",
        ),
      );
      return;
    }

    const {
      data: player,
      error: loginError,
      response,
    } = await playerLogin({
      body: { username: identifier, password },
    });

    if (response?.status === 200) {
      if (!player) {
        await playerLogout();
        setError("We signed you in but couldn't tell who you are. Please try again.");
        return;
      }
      await finishSignIn(player.id, "player", "/me");
      return;
    }

    if (response?.status === 429) setRetryAfterSeconds(getRetryAfterSeconds(response));
    setError(
      parseErrorMessage(
        loginError,
        "We couldn't sign you in. Check your username and password and try again.",
      ),
    );
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>
          <h1 className="text-center text-2xl tracking-wide">Sign In</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="identifier">Email or username</FieldLabel>
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
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
            disabled={!canSubmit}
            className="mt-5 w-full uppercase tracking-wide"
          >
            Sign In
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/sign-up" className="text-primary underline underline-offset-4">
            Create account
          </Link>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/forgot-password" className="text-primary underline underline-offset-4">
            Forgot password?
          </Link>
        </p>
      </CardFooter>
    </AuthShell>
  );
}
