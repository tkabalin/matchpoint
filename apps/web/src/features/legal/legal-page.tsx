import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";

/**
 * The shared frame for `/privacy` and `/terms` (#194) — this app's first
 * public, non-auth routes. Uses the same `AppPage`/`PageHeader` chrome every
 * other sub-page does (`install-guide.tsx`, `settings-faq.tsx`) rather than a
 * bespoke shell: an earlier version rendered `<Logo/>` directly inside a
 * bare `flex flex-col` with no `items-*`, which stretched the image to the
 * container's full width while its height stayed pinned, mangling the mark.
 * `AppPage nav={false}` keeps the bottom nav off; its `InProgressBanner` is
 * safe to render signed out, since it reads a local fixture with no request.
 *
 * Both pages are reachable from two different places — Settings while signed
 * in, sign-up while signed out — so Back can't point at a fixed destination
 * the way most `back=` props here do. It pops real browser history instead,
 * falling back to `/` only for a direct/deep link with nothing to pop.
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();

  return (
    <AppPage nav={false}>
      <PageHeader
        title={title}
        back={
          <button
            type="button"
            aria-label="Back"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            onClick={() => {
              if (router.history.canGoBack()) {
                router.history.back();
              } else {
                void router.navigate({ to: "/" });
              }
            }}
          >
            <ArrowLeft />
          </button>
        }
      />
      <div className="flex flex-col gap-4 text-sm text-muted-foreground">{children}</div>
    </AppPage>
  );
}
