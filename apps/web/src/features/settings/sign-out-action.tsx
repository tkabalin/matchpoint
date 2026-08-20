import { logout } from "@matchpoint/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { purgeLocalData } from "@/lib/local-data";

type DialogStep = "closed" | "confirm" | "success";

/**
 * Sign out, with its confirm/success dialogs — shown at the Settings root (fast,
 * single-tap access, the most common account action) and again inside Account &
 * Security (grouped with the riskier session actions), per the wireframe (#178).
 * Two real call sites for the exact same confirm/success/purge-retry behaviour, so
 * it's extracted once rather than duplicated at each.
 *
 * Takes a render-prop `trigger` (matching `Item`'s own `render` idiom elsewhere in
 * this codebase) so each call site keeps its own visual treatment — bold and
 * centred at the root, a plain row inside Account & Security — while sharing the
 * dialog logic.
 */
export function SignOutAction({ trigger }: { trigger: (openConfirm: () => void) => ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogStep, setDialogStep] = useState<DialogStep>("closed");
  const [purgeFailed, setPurgeFailed] = useState(false);

  async function handleConfirmSignOut() {
    // Logout can't fail (always 204, cookie-present or not) — nothing to branch on.
    await logout();
    try {
      // Otherwise the next coach to sign in on this device would see the previous
      // coach's roster served straight from cache. Signing out is also the one moment
      // queued points are deliberately thrown away rather than kept for a drain (#117).
      await purgeLocalData(queryClient);
    } catch {
      // The session is already gone, so the dialog has to end somewhere. It ends
      // saying the device was not cleared rather than claiming it was.
      setPurgeFailed(true);
    }
    setDialogStep("success");
  }

  async function handleAcknowledge() {
    setDialogStep("closed");
    await navigate({ to: "/" });
  }

  async function handleRetryPurge() {
    try {
      await purgeLocalData(queryClient);
      setPurgeFailed(false);
    } catch {
      // Still blocked. Leave the dialog exactly as it was rather than re-stating the
      // same failure a second way.
    }
  }

  return (
    <>
      {trigger(() => setDialogStep("confirm"))}

      <AlertDialog
        open={dialogStep === "confirm"}
        onOpenChange={(open) => !open && setDialogStep("closed")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to sign in again to access your players and matches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmSignOut}>
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialogStep === "success"} onOpenChange={() => undefined}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You've been signed out.</AlertDialogTitle>
            {purgeFailed && (
              <AlertDialogDescription>
                Some of your data could not be cleared from this device.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            {purgeFailed && <AlertDialogCancel onClick={handleRetryPurge}>Retry</AlertDialogCancel>}
            <AlertDialogAction onClick={handleAcknowledge}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
