import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";

/**
 * Answers to the questions this app's own design raises, not a general help
 * desk (#193). Plain prose on one screen, following `install-guide.tsx`'s
 * own precedent — this project has no markdown pipeline and no support
 * mailbox to route a contact form to, so a static page is the whole feature
 * rather than a stand-in for one.
 */
export function SettingsFaq() {
  return (
    <AppPage nav={false}>
      <PageHeader
        title="Help & feedback"
        back={
          <Link
            to="/settings/support"
            aria-label="Back to support"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <div className="flex flex-col gap-5">
        <Question title="What happens if I delete my account?">
          <p>
            Every player on your roster, and their entire match history, is deleted along with your
            account. This can't be undone. If you want to keep a player, transfer them to another
            coach or delete them individually first — the delete-account screen lists anyone with an
            outstanding transfer code before you can continue.
          </p>
        </Question>

        <Question title="Why does capture work with no signal?">
          <p>
            MatchPoint is built to work courtside with no connection. Points you capture are saved
            on your phone first, then sent to the server once you're back online, as long as the app
            stays open. Nothing you record is lost while you're offline.
          </p>
        </Question>

        <Question title="What is a transfer code?">
          <p>
            A one-time code that moves a player to another coach's roster, taking their match
            history with them. Generate one from a player's page, and share it with the coach
            they're moving to — cancel it at any time before it's redeemed.
          </p>
        </Question>
      </div>
    </AppPage>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
