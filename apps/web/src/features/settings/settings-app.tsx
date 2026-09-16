import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, Moon, Sun } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "@/lib/theme";

/** App (#178, wireframe 1c). Install MatchPoint is real — #130 already built
 * `/install`, this just gives it a styled row instead of the old plain-text link.
 * Appearance is a real Light/Dark toggle (#182, #200) — no "System" option, since
 * the theme is decided solely by this choice, never by the OS preference. No
 * Notifications row (#208): there's no notifications system to configure, and
 * none planned, so the stub was removed rather than left waiting on nothing. */
export function SettingsApp() {
  const [theme, setTheme] = useTheme();

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
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Appearance</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ToggleGroup
              value={[theme]}
              onValueChange={(next) => {
                if (next[0] === "light" || next[0] === "dark") setTheme(next[0]);
              }}
              variant="outline"
            >
              <ToggleGroupItem value="light" aria-label="Light">
                <Sun />
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark">
                <Moon />
              </ToggleGroupItem>
            </ToggleGroup>
          </ItemActions>
        </Item>
      </ItemGroup>
    </AppPage>
  );
}
