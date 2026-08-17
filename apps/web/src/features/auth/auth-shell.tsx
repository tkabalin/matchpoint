import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

/**
 * The shared frame every auth screen (sign in, sign up, forgot password) renders
 * inside — MATCHPOINT wordmark over a centered card. Matches wireframe "1a — Sign In"
 * from the Claude Design project; sign-up and forgot-password have no wireframe of
 * their own, so they reuse this same shell rather than each inventing their own frame.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-10 bg-background px-6 py-12">
      <div className="text-2xl font-bold tracking-tight text-primary">MATCHPOINT</div>
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  );
}
