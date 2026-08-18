import { Link } from "@tanstack/react-router";
import { Smartphone, X } from "lucide-react";
import { useState } from "react";

import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { isRunningInstalled } from "@/lib/device-platform";
import { dismissInstallPrompt, hasDismissedInstallPrompt } from "@/lib/pwa-install-prompt";

/**
 * A one-time nudge on Home pointing to the full install guide (#130). Shown once
 * per device rather than gating sign-up itself, so a first-time coach sees the app
 * work before being asked to install it. Hidden for good once dismissed, or if the
 * app is already installed.
 */
export function InstallAppNudge() {
  const [dismissed, setDismissed] = useState(
    () => hasDismissedInstallPrompt() || isRunningInstalled(),
  );

  if (dismissed) return null;

  return (
    <Item variant="outline">
      <ItemMedia>
        <Smartphone className="size-4" aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Install MatchPoint</ItemTitle>
        <ItemDescription>Add it to your home screen so it works like a normal app.</ItemDescription>
      </ItemContent>
      <div className="flex shrink-0 items-center gap-1">
        <Link to="/install" className="text-xs font-semibold text-primary">
          See how
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          onClick={() => {
            dismissInstallPrompt();
            setDismissed(true);
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    </Item>
  );
}
