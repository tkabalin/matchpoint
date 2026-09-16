import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { detectPlatform, isRunningInstalled } from "@/lib/device-platform";

/**
 * How to add MatchPoint to a home screen, plus what to expect offline (#130).
 * Reached from Settings (permanent) and from a dismissible card on Home shown once,
 * so it always starts from a real place a coach chose to go back to. Kept to one
 * screen and plain, numbered steps on purpose: this is reassurance, not a manual.
 *
 * Mounted under both the coach's and the player's own route trees (#275) —
 * `backTo` mirrors `MatchStatsPage`'s own coach/player split so each session
 * returns to its own Settings rather than the other one's, which a player
 * session can't even load.
 */
export function InstallGuide({ backTo = "/settings" }: { backTo?: "/settings" | "/me/settings" }) {
  const platform = detectPlatform();
  const installed = isRunningInstalled();

  return (
    <AppPage nav={false}>
      <PageHeader
        title="Install MatchPoint"
        back={
          <Link
            to={backTo}
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      {installed ? (
        <p className="text-sm text-muted-foreground">
          MatchPoint is already installed on this device.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Installing MatchPoint puts it on your home screen, so it opens like any other app, even
            with no signal.
          </p>
          {platform === "ios" && <IosSteps />}
          {platform === "android" && <AndroidSteps />}
          {platform === "other" && (
            <p className="text-sm text-muted-foreground">
              Open this page on your phone to see the steps for your device.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">If you lose signal during a match</h2>
        <p className="text-sm text-muted-foreground">
          You can keep tracking points with no signal at all. MatchPoint saves everything on your
          phone and sends it to the server once you have signal again, as long as the app is still
          open. Try not to close the app until it has had a chance to sync.
        </p>
      </div>
    </AppPage>
  );
}

function IosSteps() {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
      <li>
        Tap the <strong>Share</strong> button in Safari. It looks like a square with an arrow
        pointing up.
      </li>
      <li>
        Scroll down and tap <strong>Add to Home Screen</strong>.
      </li>
      <li>
        Tap <strong>Add</strong> in the top right corner.
      </li>
    </ol>
  );
}

function AndroidSteps() {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
      <li>
        Tap the <strong>menu</strong> button in Chrome. It looks like three dots in the top right
        corner.
      </li>
      <li>
        Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.
      </li>
      <li>
        Tap <strong>Add</strong> or <strong>Install</strong> to confirm.
      </li>
    </ol>
  );
}
