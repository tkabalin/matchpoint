import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";

import { StubRow } from "./stub-row";

/** Support (#178, wireframe 1c). All three rows are stubs — real content lands in
 * #193 (help/contact), #194 (privacy/terms), and #195 (app version) respectively. */
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
        <StubRow label="Help & feedback" />
        <StubRow label="Privacy policy / Terms" />
        <StubRow label="App version" />
      </ItemGroup>
    </AppPage>
  );
}
