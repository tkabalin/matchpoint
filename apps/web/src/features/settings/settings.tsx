import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";

import { SignOutAction } from "./sign-out-action";

const CATEGORIES = [
  { to: "/settings/match-defaults", label: "Match Defaults" },
  { to: "/settings/account", label: "Account & Security" },
  { to: "/settings/app", label: "App" },
  { to: "/settings/support", label: "Support" },
] as const;

/**
 * Settings root — a drill-down menu (#178, wireframe 1c): a handful of category
 * rows rather than one long flat list, so the riskier actions inside each category
 * sit one tap further from an idle thumb. Sign out is the one exception promoted
 * back up here, since it's the single most common reason a coach opens Settings at
 * all (Fitts's Law — the frequent, safe action gets the closest target).
 */
export function Settings() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="Settings"
        back={
          <Link
            to="/home"
            aria-label="Back to home"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

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
        trigger={(openConfirm) => (
          <Item render={<button type="button" onClick={openConfirm} />} className="justify-center">
            <ItemTitle className="font-bold">Sign Out</ItemTitle>
          </Item>
        )}
      />
    </AppPage>
  );
}
