import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { PlayerList } from "@/features/players/player-list";

export function App() {
  // Held in state rather than at module scope so each mounted app gets its own cache —
  // a module-level client would carry one test's fetched data into the next.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4">
        <h1 className="text-3xl font-semibold">MatchPoint</h1>
        <PlayerList />
      </main>
    </QueryClientProvider>
  );
}
