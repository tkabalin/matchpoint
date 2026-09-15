import { Link } from "@tanstack/react-router";

import { COACH_TABS } from "@/components/nav-tabs";
import type { NavTab } from "@/components/nav-tabs";

// `min-h-nav`, not `h-nav`: `--spacing-nav` is this bar's own measured height, so the
// two agree today, but a fixed height would clip the labels down into the home-indicator
// padding if a label or icon ever grew. The floor is what the token has to guarantee.
export function BottomNav({ tabs = COACH_TABS }: { tabs?: NavTab[] }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex min-h-nav justify-around border-t bg-background pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          activeProps={{
            "aria-current": "page",
            className: "text-primary font-semibold",
          }}
          inactiveProps={{ className: "text-muted-foreground" }}
          className="flex flex-col items-center gap-0.5 px-3 text-[0.625rem]"
        >
          <tab.icon className="size-5" />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
