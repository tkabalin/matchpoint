import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Outlet, useRouteContext } from "@tanstack/react-router";

import { queryPersistOptions } from "@/lib/query-persist";

export function RootLayout() {
  // Read from router context rather than created here: the _authenticated guard's
  // beforeLoad needs the same QueryClient before this component ever renders, so it's
  // built once at createRouter() in main.tsx and threaded through as context instead.
  const { queryClient } = useRouteContext({ from: "__root__" });

  return (
    // PersistQueryClientProvider rather than a plain QueryClientProvider: as well as
    // restoring the IndexedDB copy it holds every query rendered under it off the
    // network until that restore lands. The _authenticated guard's beforeLoad runs
    // before this mounts, so it fetches ahead of the restore and says why.
    <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
      <Outlet />
    </PersistQueryClientProvider>
  );
}
