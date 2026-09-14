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
import { countUnsyncedRows, purgeLocalData } from "@/lib/local-data";

/**
 * Sign out, with its confirm dialog — shown at the Settings root (fast,
 * single-tap access, the most common account action) and again inside Account &
 * Security (grouped with the riskier session actions), per the wireframe (#178).
 * Two real call sites for the exact same confirm behaviour, so it's extracted
 * once rather than duplicated at each. A player's own Settings screen (#203) is a
 * third: `logoutFn` and `description` are what let it reuse this rather than
 * cloning the dialog for `playerLogout`.
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
export function SignOutAction({
  trigger,
  logoutFn = logout,
  description = "You'll need to sign in again to access your players and matches.",
}: {
  trigger: (openConfirm: () => void) => ReactNode;
  logoutFn?: () => Promise<unknown>;
  description?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState<number | null>(null);

  // Checked before the dialog opens, not while it's up: it's a local IndexedDB
  // count, fast enough that the dialog never needs a loading state of its own.
  function handleOpenConfirm() {
    void (async () => {
      setUnsyncedCount(await countUnsyncedRows());
      setConfirmOpen(true);
    })();
  }

  async function handleConfirmSignOut() {
    // Logout can't fail (always 204, cookie-present or not) — nothing to branch on.
    await logoutFn();
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
      {trigger(handleOpenConfirm)}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              {description}
              {unsyncedCount !== null && unsyncedCount > 0 && (
                <>
                  {" "}
                  {unsyncedCount === 1
                    ? "1 point hasn't been saved to the server yet."
                    : `${unsyncedCount} points haven't been saved to the server yet.`}{" "}
                  They'll be lost if you sign out now.
                </>
              )}
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
