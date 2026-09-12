import { getCurrentCoachOptions } from "@matchpoint/api-client/react-query";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";

import { SignIn } from "@/features/auth/sign-in";
import { getRecordedOwner } from "@/lib/local-data";

// The inverse of `_authenticated.tsx`'s guard: that one redirects to `/` only on a
// *confirmed* 401, this one redirects away from `/` only on a *confirmed* session, so
// the two cannot ping-pong. Needed because `start_url` is `/` (pwa-config.ts), so every
// launch of the installed PWA lands here regardless of whether the session is still
// good (#257) — nothing before this ever re-checked one at start-up.
export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
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
      // ensureQueryData cannot read the courtside case off the cache the way
      // _authenticated's own guard does: PersistQueryClientProvider restores that
      // cache into this same queryClient on mount, in RootLayout, which runs after
      // this beforeLoad rather than before it (see root-layout.tsx's own comment).
      // So a network failure here — offline, with nothing in memory yet — always
      // falls into this catch with nothing to show for it, and the coach would see
      // the form despite a session that's still good.
      //
      // getRecordedOwner() is the offline-safe fallback: set the moment any session
      // check first succeeds on this device (recordOwnerIfUnknown, in
      // _authenticated.tsx) and cleared only by an explicit sign-out
      // (purgeLocalData), never by a network hiccup. Optimistic, not authoritative —
      // if the session has genuinely died without a sign-out (expired, revoked
      // elsewhere), this redirects into /home anyway and _authenticated's own guard,
      // which does get a real network attempt, bounces back to / once it can tell.
      if (getRecordedOwner() !== null) throw redirect({ to: "/home" });
    }
  },
  component: SignIn,
});
