import { Outlet } from "@tanstack/react-router";

import { Logo } from "@/components/logo";

/**
 * Every real app screen renders through here — `_authenticated.tsx` is the one
 * pathless layout route every protected page sits under, so putting the persistent
 * mark here (rather than in `AppPage`, or per-screen) is what actually guarantees
 * "every page" without depending on each screen remembering to include it. `sticky`
 * rather than `fixed`: it occupies real space in the flow, so nothing below it
 * needs compensating padding the way `BottomNav`'s `fixed` placement does.
 */
export function AuthenticatedLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex justify-center border-b bg-background py-2">
        <Logo size="compact" />
      </header>
      {/* One shared viewport-height column rather than the header's own space plus a
          separate 100dvh block below it — capture's full-viewport screen relies on this
          to get exactly what's left after the header, not the header's height on top. */}
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
