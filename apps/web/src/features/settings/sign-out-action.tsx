import { logout } from "@matchpoint/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

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

/**
 * Sign out, with its confirm dialog — shown at the Settings root (fast,
 * single-tap access, the most common account action) and again inside Account &
 * Security (grouped with the riskier session actions), per the wireframe (#178).
 * Two real call sites for the exact same confirm behaviour, so it's extracted
 * once rather than duplicated at each.
 *
 * Takes a render-prop `trigger` (matching `Item`'s own `render` idiom elsewhere in
 * this codebase) so each call site keeps its own visual treatment — bold and
 * centred at the root, a plain row inside Account & Security — while sharing the
 * dialog logic.
 *
 * One confirmation, not two (#182): the "Sign out?" dialog is the confirmation:
 * confirming it navigates straight to sign-in with no second "you've been signed
 * out" dialog to dismiss afterwards.
 */
export function SignOutAction({ trigger }: { trigger: (openConfirm: () => void) => ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirmSignOut() {
    // Logout can't fail (always 204, cookie-present or not) — nothing to branch on.
    await logout();
    try {
      // Otherwise the next coach to sign in on this device would see the previous
      // coach's roster served straight from cache. Signing out is also the one moment
      // queued points are deliberately thrown away rather than kept for a drain (#117).
      await purgeLocalData(queryClient);
    } catch {
      // The session is already gone and sign-out proceeds regardless — a toast
      // rather than blocking the flow on a dialog the coach would have to dismiss.
      toast.error("Some of your data could not be cleared from this device.");
    }
    setConfirmOpen(false);
    await navigate({ to: "/" });
  }

  return (
    <>
      {trigger(() => setConfirmOpen(true))}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
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
    </>
  );
}
