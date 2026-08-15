import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { useState } from "react";

export function RootLayout() {
  // Held in state rather than at module scope so each mounted app gets its own cache —
  // a module-level client would carry one test's fetched data into the next.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
