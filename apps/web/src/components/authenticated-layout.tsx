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
    <>
      <header className="sticky top-0 z-40 flex justify-center border-b bg-background py-2">
        <Logo size="compact" />
      </header>
      <Outlet />
    </>
  );
}
