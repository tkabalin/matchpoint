import { Link } from "@tanstack/react-router";

import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

/**
 * Rendered for any URL that matches no route at all — set as `__root.tsx`'s
 * `notFoundComponent`, which TanStack Router falls back to when nothing more
 * specific claims the path. Distinct from #78's "this player isn't yours" state,
 * which is a real route that loaded and then found nothing — this one never
 * matched a route in the first place.
 *
 * Reachable before sign-in as easily as after it (a stale link, a typo, a bookmark
 * from a build that renamed a route), so this can't assume an authenticated
 * session — no AppPage, no bottom nav, same standalone treatment AuthShell uses.
 * The link goes to /home rather than branching on auth state itself: an
 * unauthenticated visitor hits the existing _authenticated guard and lands on
 * sign-in anyway, and a signed-in coach goes straight to their real home page.
 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-6 py-12 text-center">
      <Logo size="hero" />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-wide">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you're looking for doesn't exist or may have moved.
        </p>
      </div>
      <Link to="/home" className={buttonVariants()}>
        Back to home
      </Link>
    </div>
  );
}
