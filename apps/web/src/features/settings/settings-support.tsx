import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { APP_VERSION } from "@/lib/app-version";

/** Support (#178, wireframe 1c). All three original stub rows are real now:
 * Help & feedback (#193) is a static FAQ page; Privacy policy and Terms of
 * Service (#194) are their own public routes — split into two rows rather
 * than the wireframe's one combined row, matching how every other row here
 * is one destination each; App version (#195) reads at build time from
 * package.json (`lib/app-version.ts`), so it updates on release rather than
 * needing a manual edit. */
export function SettingsSupport() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="Support"
        back={
          <Link
            to="/settings"
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <ItemGroup>
        <Item variant="outline" render={<Link to="/settings/support/faq" />}>
          <ItemContent>
            <ItemTitle>Help & feedback</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
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
