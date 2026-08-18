import { Link } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { getErrorStatus } from "@/lib/error-status";

/**
 * What to show when reading a player by id fails.
 *
 * The API answers 404 rather than 403 for another coach's player, deliberately: a
 * 403 would confirm the id exists. So this must not word it as a permission
 * problem — "not found" has to stay indistinguishable from a mistyped id, which is
 * the whole point of the API returning 404 (#78).
 *
 * 401 is the other branch worth separating: the session is gone rather than the
 * player, and the way out is signing in again rather than the roster.
 *
 * role="alert" on every branch: `Empty` carries none by default, and without it
 * a failed load is silent to a screen reader instead of announcing itself —
 * caught by e2e/smoke.spec.ts, which asserts getByRole("alert") on this exact
 * failure.
 */
export function PlayerLoadError({ error }: { error: unknown }) {
  const status = getErrorStatus(error);

  if (status === 401) {
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyTitle>Your session has expired</EmptyTitle>
          <EmptyDescription>Sign in again to pick up where you left off.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to="/" className={buttonVariants()}>
            Sign in
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  if (status === 404) {
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyTitle>Player not found</EmptyTitle>
          <EmptyDescription>Check the link, or pick a player from your roster.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to="/players" className={buttonVariants({ variant: "outline" })}>
            Go to roster
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyTitle>Could not load that player.</EmptyTitle>
        <EmptyDescription>Something went wrong on our end. Try again in a moment.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
