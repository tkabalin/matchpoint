import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";

/** App (#178, wireframe 1c). Install MatchPoint is real — #130 already built
 * `/install`, this just gives it a styled row instead of the old plain-text link.
 * No Appearance row: dark mode is deactivated, so there's no longer a choice to
 * offer here — `lib/theme.ts` always resolves light regardless of what a coach
 * may have picked before this shipped. No Notifications row (#208): there's no
 * notifications system to configure, and none planned, so the stub was removed
 * rather than left waiting on nothing. */
export function SettingsApp() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="App"
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
        <Item variant="outline" render={<Link to="/install" />}>
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
