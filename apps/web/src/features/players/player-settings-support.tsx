import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { APP_VERSION } from "@/lib/app-version";

/** A player's Support settings, matching the coach's `settings-support.tsx` save
 * for Help & feedback: that page answers questions about a roster, transfer codes
 * and deleting a coach account, none of which a player has, so it would be the
 * wrong document rather than a missing row. Privacy and Terms are public routes
 * either principal can load. */
export function PlayerSettingsSupport() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="Support"
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
        <Item variant="outline" render={<Link to="/privacy" />}>
          <ItemContent>
            <ItemTitle>Privacy policy</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
        <Item variant="outline" render={<Link to="/terms" />}>
          <ItemContent>
            <ItemTitle>Terms of Service</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>App version</ItemTitle>
          </ItemContent>
          <ItemActions>
            <span className="text-sm text-muted-foreground">{APP_VERSION}</span>
          </ItemActions>
        </Item>
      </ItemGroup>
    </AppPage>
  );
}
