import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { APP_VERSION } from "@/lib/app-version";

import { StubRow } from "./stub-row";

/** Support (#178, wireframe 1c). Privacy/Terms is still a stub — real content
 * lands in #194. Help & feedback is real (#193): a static FAQ page, following
 * `install-guide.tsx`'s own precedent. App version is real (#195): read at
 * build time from package.json (`lib/app-version.ts`), so it updates on
 * release rather than needing a manual edit. */
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
        <StubRow label="Privacy policy / Terms" />
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
