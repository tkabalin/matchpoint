import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, useRouteContext } from "@tanstack/react-router";

export function RootLayout() {
  // Read from router context rather than created here: the _authenticated guard's
  // beforeLoad needs the same QueryClient before this component ever renders, so it's
  // built once at createRouter() in main.tsx and threaded through as context instead.
  const { queryClient } = useRouteContext({ from: "__root__" });

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
