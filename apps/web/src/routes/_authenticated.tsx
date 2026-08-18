import { getCurrentCoachOptions } from "@matchpoint/api-client/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthenticatedLayout } from "@/components/authenticated-layout";
import { getErrorStatus } from "@/lib/error-status";

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
      await context.queryClient.ensureQueryData({ ...getCurrentCoachOptions(), retry: false });
    } catch (error) {
      // Only a confirmed 401 ends the visit — a network blip or a transient 500
      // renders through instead of signing someone out for an unrelated failure.
      if (getErrorStatus(error) === 401) throw redirect({ to: "/" });
    }
  },
  component: AuthenticatedLayout,
});
