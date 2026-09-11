import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

/**
 * The shared frame for `/privacy` and `/terms` (#194) — this app's first
 * public, non-auth routes, so they render outside `AuthenticatedLayout`
 * (no bottom nav) rather than reusing `AppPage`, which pulls in
 * authenticated-only chrome. Not `AuthShell` either: that shell is a narrow
 * centered card built for a login form, not a page meant to be read.
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <Logo size="compact" />
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="flex flex-col gap-4 text-sm text-muted-foreground">{children}</div>
      <Link to="/" className="text-sm text-primary underline underline-offset-4">
        Back to sign in
      </Link>
    </div>
  );
}
