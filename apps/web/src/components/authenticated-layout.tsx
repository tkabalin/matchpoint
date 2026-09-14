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
    // Grid + `h-dvh`, not flex + `min-h-dvh`: capture's court diagram sizes itself off a
    // `container-type: size` box several flex layers down, and that container query
    // went stale (0×0) when every layer above it was only flex-grown rather than
    // resting on a genuinely definite ancestor size. A `1fr` grid row against an
    // explicit `h-dvh` is definite from this one hop; a page taller than one viewport
    // still grows past it and scrolls, via `min-h-0` on the row rather than clipping.
    // `grid-cols-1` matters just as much as the rows: with no column track declared
    // at all, this grid's one implicit column defaults to a bare `auto` track, which
    // sizes itself off a child's max-content/max-width (AppPage's own `max-w-md`,
    // 448px) rather than the viewport — the classic CSS Grid "blowout" bug. Tailwind's
    // `grid-cols-*` utilities always wrap their tracks in `minmax(0, 1fr)` specifically
    // to prevent this; a grid with only `grid-rows-[...]` and no `grid-cols-*` gets no
    // such protection on its column axis. Measured directly: without this, on a
    // narrow long name (Home's attention flag, a Matches card's opponent name), this
    // row rendered at a fixed 448px regardless of a 412px-wide phone, silently clipped
    // by the global overflow-x:hidden backstop rather than visibly breaking anything.
    <div className="grid h-dvh grid-cols-1 grid-rows-[auto_1fr]">
      <header className="sticky top-0 z-40 flex justify-center border-b bg-background py-2">
        <Logo size="compact" />
      </header>
      <div className="min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
