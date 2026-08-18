import { getCurrentCoachOptions } from "@matchpoint/api-client/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthenticatedLayout } from "@/components/authenticated-layout";
import { getErrorStatus } from "@/lib/error-status";
import { clearCachedReads, recordOwnerIfUnknown } from "@/lib/local-data";

// Pathless layout: every currently-protected route is renamed with this prefix so it
// runs through this one session check rather than each route repeating its own.
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context }) => {
    try {
      // ensureQueryData checks the cache before the network, so a coach who is
      // offline but has a cached profile isn't kicked out just because the request
      // can't complete. retry: false overrides Query's default 3-attempt backoff —
      // without it, a real 401 takes several seconds of retries before this can even
      // decide whether to redirect.
      const coach = await context.queryClient.ensureQueryData({
        ...getCurrentCoachOptions(),
        retry: false,
        // Query's default networkMode leaves a fetch *paused*, never settled, while
        // the browser reports itself offline, so this await would hang and no guarded
        // route would render at all. offlineFirst lets the attempt fail instead.
        networkMode: "offlineFirst",
      });
      // Sessions outlive releases, so a coach signed in before #117 shipped has no
      // ownership record and their own next sign-in would read as a stranger's, taking
      // their unsynced points with it. Claims the device only when nothing claims it.
      recordOwnerIfUnknown(coach.id);
    } catch (error) {
      // Only a confirmed 401 ends the visit — a network blip or a transient 500
      // renders through instead of signing someone out for an unrelated failure.
      if (getErrorStatus(error) === 401) {
        // Cached reads only. The queue of unsynced points survives a session the
        // server ended, along with the record of whose device this is, so the same
        // coach signing back in still has the points they captured courtside (#117).
        await clearCachedReads(context.queryClient);
        throw redirect({ to: "/" });
      }
    }
  },
  component: AuthenticatedLayout,
});
