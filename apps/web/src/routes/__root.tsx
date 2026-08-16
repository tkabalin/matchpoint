import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

import { RootLayout } from "@/components/root-layout";

// The QueryClient is threaded in as router context (built at createRouter() call in
// main.tsx) rather than created here, so route beforeLoad hooks — the _authenticated
// guard's ensureQueryData call, in particular — can reach it before any component
// renders.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});
