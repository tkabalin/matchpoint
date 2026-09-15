import type { ReactNode } from "react";

import { BottomNav } from "@/components/bottom-nav";
import { InProgressBanner } from "@/components/in-progress-banner";
import { COACH_TABS } from "@/components/nav-tabs";
import type { NavTab } from "@/components/nav-tabs";
import { cn } from "@/lib/utils";

/**
 * The phone-shaped column every screen sits in.
 *
 * The bottom nav is fixed, so the padding that keeps content clear of it belongs
 * here rather than being remembered at each page. `InProgressBanner` lives here
 * too, not at each call site — a coach mid-match can be on any authenticated
 * screen, not just home and matches, so the way back has to follow them
 * everywhere rather than being remembered per page. Harmless on a player's own
 * screens too: it reads this device's recorded owner, and a player never holds a
 * capture claim, so it has nothing to show there either way.
 */
export function AppPage({
  children,
  nav = true,
  tabs = COACH_TABS,
  className,
}: {
  children: ReactNode;
  /** False for screens reached as a flow rather than a nav destination. */
  nav?: boolean;
  /** The coach's four tabs by default; a player's own screens pass `PLAYER_TABS`. */
  tabs?: NavTab[];
  className?: string;
}) {
  return (
    <>
      <div
        className={cn(
          "mx-auto flex w-full max-w-md flex-col gap-3 px-4 pt-4",
          nav ? "pb-[calc(var(--spacing-nav)+2rem)]" : "pb-8",
          className,
        )}
      >
        <InProgressBanner />
        {children}
      </div>
      {nav && <BottomNav tabs={tabs} />}
    </>
  );
}

/**
 * `back` and `trailing` take fully-formed nodes rather than route props so callers
 * keep TanStack Router's typed `to`/`params` checking at their own call site.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  trailing,
  centred = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: ReactNode;
  trailing?: ReactNode;
  /** Titles sit between a back control and a trailing one on flow screens. */
  centred?: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-2">
      {back}
      <div className={cn("min-w-0", centred ? "text-center" : "flex-1")}>
        <h1 className={cn("truncate font-bold", centred ? "text-base" : "text-xl")}>{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {/* Keeps a centred title actually centred when there's no trailing control. */}
      {trailing ?? (centred && back ? <span className="size-8 shrink-0" /> : null)}
    </header>
  );
}
