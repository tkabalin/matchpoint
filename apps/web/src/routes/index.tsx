import {
  getCurrentCoachOptions,
  getCurrentPlayerOptions,
} from "@matchpoint/api-client/react-query";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";

import { SignIn } from "@/features/auth/sign-in";
import { getErrorStatus } from "@/lib/error-status";
import { getRecordedOwnerKind } from "@/lib/local-data";

// The inverse of `_authenticated.tsx`'s and `_player.tsx`'s guards: those redirect to
// `/` only on a *confirmed* 401, this one redirects away from `/` only on a
// *confirmed* session, so none of the three can ping-pong each other. Needed because
// `start_url` is `/` (pwa-config.ts), so every launch of the installed PWA lands here
// regardless of whether a session — a coach's or a player's — is still good (#257).
export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    // Tracked per check rather than bailing on the first non-redirect error: a
    // *confirmed* 401 from one role's endpoint says nothing about the other
    // (a player session 401s against /coaches/me and vice versa), so both have
    // to be tried before anything can be concluded either way.
    let coachConfirmedNoSession: boolean;
    try {
      // retry: false is what keeps a real signed-out visit from sitting through
      // Query's default 3-attempt backoff before the form ever shows.
      await context.queryClient.ensureQueryData({
        ...getCurrentCoachOptions(),
        retry: false,
        networkMode: "offlineFirst",
      });
      throw redirect({ to: "/home" });
    } catch (error) {
      // The redirect just thrown above lands in this same catch, so it has to be
      // let through rather than swallowed as a failed session check.
      if (isRedirect(error)) throw error;
      coachConfirmedNoSession = getErrorStatus(error) === 401;
    }

    let playerConfirmedNoSession: boolean;
    try {
      await context.queryClient.ensureQueryData({
        ...getCurrentPlayerOptions(),
        retry: false,
        networkMode: "offlineFirst",
      });
      throw redirect({ to: "/me" });
    } catch (error) {
      if (isRedirect(error)) throw error;
      playerConfirmedNoSession = getErrorStatus(error) === 401;
    }

    // Both checks came back with a definite "no session" — there is nothing left
    // to guess, so the form is the honest answer regardless of what's recorded
    // locally. Falling back here anyway was a real bug: getRecordedOwnerKind()
    // is never cleared by a session dying server-side (only an explicit
    // sign-out clears it), so a coach or player whose session was revoked
    // elsewhere would get redirected straight back into the app, whose own
    // guard would 401 for real, clear the cache, and redirect back to /,
    // landing right back here with the marker still set — an infinite loop
    // between / and /home (or /me), never once showing the form.
    if (coachConfirmedNoSession && playerConfirmedNoSession) return;

    // At least one check was inconclusive — a genuine network failure rather
    // than a confirmed refusal — which is the courtside case: offline, with
    // nothing in memory yet, since PersistQueryClientProvider restores the
    // persisted cache into this same queryClient on mount, in RootLayout,
    // which runs after this beforeLoad rather than before it (root-layout.tsx's
    // own comment). getRecordedOwnerKind() is the offline-safe fallback for
    // that case: recorded alongside the owner id the moment any session check
    // first succeeds on this device (recordOwnerIfUnknown, in both
    // _authenticated.tsx and _player.tsx), cleared only by an explicit
    // sign-out. Optimistic, not authoritative: if the session actually died
    // without a sign-out while this device stays offline, the coach or player
    // lands in the app and finds out once a request can actually reach the
    // server.
    const kind = getRecordedOwnerKind();
    if (kind === "coach") throw redirect({ to: "/home" });
    if (kind === "player") throw redirect({ to: "/me" });
  },
  component: SignIn,
});
