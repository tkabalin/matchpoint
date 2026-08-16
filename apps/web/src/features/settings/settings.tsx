import { logout } from "@matchpoint/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";

type DialogStep = "closed" | "confirm" | "success";

export function Settings() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogStep, setDialogStep] = useState<DialogStep>("closed");

  async function handleConfirmSignOut() {
    // Logout can't fail (always 204, cookie-present or not) — nothing to branch on.
    await logout();
    // Otherwise the next coach to sign in on this device would see the previous
    // coach's roster served straight from cache.
    queryClient.clear();
    setDialogStep("success");
  }

  async function handleAcknowledge() {
    setDialogStep("closed");
    await navigate({ to: "/" });
  }

  return (
    <div>
      <h1>Settings</h1>
      <Button variant="outline" onClick={() => setDialogStep("confirm")}>
        Sign Out
      </Button>

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
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleAcknowledge}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
