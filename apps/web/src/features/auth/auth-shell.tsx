import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { Card } from "@/components/ui/card";

/**
 * The shared frame every auth screen (sign in, sign up, forgot password) renders
 * inside — the MatchPoint mark over a centered card. Matches wireframe "1a — Sign In"
 * from the Claude Design project; sign-up and forgot-password have no wireframe of
 * their own, so they reuse this same shell rather than each inventing their own frame.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-background px-6 py-12">
      <Logo size="hero" />
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  );
}
