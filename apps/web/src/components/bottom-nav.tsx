import { Link } from "@tanstack/react-router";
import { ChartColumn, House, Users, Volleyball } from "lucide-react";
import type { ComponentType } from "react";

const TABS: { to: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { to: "/home", label: "Home", icon: House },
  { to: "/players", label: "Players", icon: Users },
  { to: "/matches", label: "Matches", icon: Volleyball },
  { to: "/stats", label: "Stats", icon: ChartColumn },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t bg-background pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {TABS.map((tab) => (
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
