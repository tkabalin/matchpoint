import { playerLogout } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { PLAYER_TABS } from "@/components/nav-tabs";
import { AppPage, PageHeader } from "@/components/page-shell";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { SignOutAction } from "@/features/settings/sign-out-action";

const CATEGORIES = [
  { to: "/me/settings/account", label: "Account & Security" },
  { to: "/me/settings/app", label: "App" },
  { to: "/me/settings/support", label: "Support" },
] as const;

/**
 * A player's Settings root — the same drill-down menu the coach's `settings.tsx`
 * is, minus Match Defaults, which configures how a coach starts a match and so
 * has nothing to set for the player being tracked.
 *
 * Keeps the bottom nav the coach's root drops: Settings is one of a player's
 * three nav tabs (`PLAYER_TABS`), not a screen reached from a header button, so
 * there is no single place for a back arrow to return to.
 */
export function PlayerSettings() {
  return (
    <AppPage tabs={PLAYER_TABS}>
      <PageHeader title="Settings" />

      <ItemGroup>
        {CATEGORIES.map((category) => (
          <Item key={category.to} variant="outline" render={<Link to={category.to} />}>
            <ItemContent>
              <ItemTitle>{category.label}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>

      <Separator />

      <SignOutAction
        logoutFn={playerLogout}
        description="You'll need to sign in again to access your matches."
        trigger={(openConfirm) => (
          <Item render={<button type="button" onClick={openConfirm} />} className="justify-center">
            <ItemTitle className="font-bold">Sign Out</ItemTitle>
          </Item>
        )}
      />
    </AppPage>
  );
}
