import { ChartColumn, House, Settings, User, Users, Volleyball } from "lucide-react";
import type { ComponentType } from "react";

// Split out of bottom-nav.tsx: a file exporting a component may not also export a
// constant array (react-refresh/only-export-components) — these are consumed by
// `AppPage` (page-shell.tsx) as well as `BottomNav` itself.

export interface NavTab {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const COACH_TABS: NavTab[] = [
  { to: "/home", label: "Home", icon: House },
  { to: "/players", label: "Players", icon: Users },
  { to: "/matches", label: "Matches", icon: Volleyball },
  { to: "/stats", label: "Squad stats", icon: ChartColumn },
];

// A player's whole app is their own stats, their own matches, and changing their
// password — no roster, no Home dashboard, no squad-wide screens (#203).
export const PLAYER_TABS: NavTab[] = [
  { to: "/me", label: "Me", icon: User },
  { to: "/me/matches", label: "Matches", icon: Volleyball },
  { to: "/me/settings", label: "Settings", icon: Settings },
];
