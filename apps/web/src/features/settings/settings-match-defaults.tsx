import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";

import { StubRow } from "./stub-row";

/** Match Defaults (#178, wireframe 1c). Both rows are stubs — #104 (letting a coach
 * set the surface/scoring a new match starts from) isn't built yet. */
export function SettingsMatchDefaults() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="Match Defaults"
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
        <StubRow label="Default surface" />
        <StubRow label="Default sets format" />
      </ItemGroup>
    </AppPage>
  );
}
