import { getCurrentPlayerOptions } from "@matchpoint/api-client/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthenticatedLayout } from "@/components/authenticated-layout";
import { getErrorStatus } from "@/lib/error-status";
import { clearCachedReads, recordOwnerIfUnknown } from "@/lib/local-data";

// A player's own pathless layout, disjoint from `_authenticated` (the coach's): every
// route under here is one a player may reach, and nothing under `_authenticated` is —
// a player typing /home or /stats bounces because those routes are not theirs to
// reach, not because a conditional inside them remembered to hide something. Shares
// `AuthenticatedLayout` with the coach's, since it's pure chrome (a logo header); the
// only thing it can't know for itself is which home the mark leads back to.
export const Route = createFileRoute("/_player")({
  beforeLoad: async ({ context }) => {
    try {
      const player = await context.queryClient.ensureQueryData({
        ...getCurrentPlayerOptions(),
        retry: false,
        networkMode: "offlineFirst",
      });
      recordOwnerIfUnknown(player.id, "player");
    } catch (error) {
      if (getErrorStatus(error) === 401) {
        await clearCachedReads(context.queryClient);
        throw redirect({ to: "/" });
      }
    }
  },
  component: () => <AuthenticatedLayout home="/me" />,
});
