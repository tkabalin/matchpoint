import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";

/** A player's App settings, matching the coach's `settings-app.tsx` row for row —
 * the install guide is the only thing either of them has to offer, and a player
 * reaches their own copy of it at `/me/install` (#275). */
export function PlayerSettingsApp() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="App"
        back={
          <Link
            to="/me/settings"
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <ItemGroup>
        <Item variant="outline" render={<Link to="/me/install" />}>
          <ItemContent>
            <ItemTitle>Install MatchPoint</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
      </ItemGroup>
    </AppPage>
  );
}
