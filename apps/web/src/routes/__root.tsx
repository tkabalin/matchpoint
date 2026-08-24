import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/not-found-page";
import { RootErrorBanner } from "@/components/root-error-banner";
import { RootLayout } from "@/components/root-layout";

// The QueryClient is threaded in as router context (built at createRouter() call in
// main.tsx) rather than created here, so route beforeLoad hooks — the _authenticated
// guard's ensureQueryData call, in particular — can reach it before any component
// renders.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  // Set here rather than the deprecated router-level notFoundRoute option (#131):
  // a root route's notFoundComponent is what TanStack Router falls back to once
  // nothing more specific has claimed a path, so this covers every unmatched URL
  // in the app in one place. errorComponent is the same idea for a render or loader
  // throwing anywhere in the tree (#180) — no error boundary existed at all before this.
  notFoundComponent: NotFoundPage,
  errorComponent: RootErrorBanner,
});
