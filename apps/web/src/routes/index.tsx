import { getCurrentCoachOptions } from "@matchpoint/api-client/react-query";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";

import { SignIn } from "@/features/auth/sign-in";
import { getErrorStatus } from "@/lib/error-status";
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
      // A *confirmed* 401 means there is definitely no session on this device —
      // show the form, and don't fall back to the marker below. Falling back here
      // was a real bug: getRecordedOwner() is never cleared by a session dying
      // server-side (only an explicit sign-out clears it), so a coach whose
      // session was revoked elsewhere would get bounced straight back to /home,
      // whose own guard would 401 for real, clear the cache, and redirect back
      // to / — landing right back in this same catch with the marker still set,
      // looping forever instead of ever showing the form.
      if (getErrorStatus(error) === 401) return;
      // ensureQueryData cannot read the courtside case off the cache the way
      // _authenticated's own guard does: PersistQueryClientProvider restores that
      // cache into this same queryClient on mount, in RootLayout, which runs after
      // this beforeLoad rather than before it (see root-layout.tsx's own comment).
      // So a network failure here — offline, with nothing in memory yet — always
      // falls into this catch with nothing to show for it, and the coach would see
      // the form despite a session that's still good.
      //
      // getRecordedOwner() is the offline-safe fallback for exactly that case: set
      // the moment any session check first succeeds on this device
      // (recordOwnerIfUnknown, in _authenticated.tsx), cleared only by an explicit
      // sign-out (purgeLocalData), never by a network hiccup. Optimistic, not
      // authoritative — if the session has genuinely died without a sign-out while
      // this device stays offline, the coach lands on /home and finds out once a
      // request can actually reach the server.
      if (getRecordedOwner() !== null) throw redirect({ to: "/home" });
    }
  },
  component: SignIn,
});
