import { revokeOtherSessions } from "@matchpoint/api-client";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
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
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";

import { DeleteAccountSheet } from "./delete-account-sheet";
import { SignOutAction } from "./sign-out-action";

type RevokeStep = "closed" | "confirm" | "success";

/**
 * Account & Security (#178, wireframe 1c). Change password now leaves Settings
 * entirely — it links to `/forgot-password` (the existing email-OTP flow) instead
 * of the old in-settings current/new/confirm form, a deliberate scope decision:
 * that flow doesn't ask for the current password and can end with the coach
 * needing to sign back in, unlike the form it replaces. It's a button with its own
 * confirm dialog, not a bare `Link`, so it reads the same as Sign Out beside it —
 * one tile style for every row in this group, not "the one that happens to
 * navigate" standing out.
 */
export function SettingsAccount() {
  const navigate = useNavigate();
  const [revokeStep, setRevokeStep] = useState<RevokeStep>("closed");
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [confirmingPasswordChange, setConfirmingPasswordChange] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  async function handleConfirmRevoke() {
    setRevoking(true);
    setRevokeError(null);
    try {
      const { error, response } = await revokeOtherSessions();
      if (response?.status === 204) {
        setRevokeStep("success");
        return;
      }
      setRevokeError(error?.detail ?? "Could not sign out of other sessions.");
      setRevokeStep("closed");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <AppPage nav={false}>
      <PageHeader
        title="Account & Security"
        back={
          <Link
            to="/settings"
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <ItemGroup>
        <Item
          variant="outline"
          render={<button type="button" onClick={() => setConfirmingPasswordChange(true)} />}
        >
          <ItemContent>
            <ItemTitle>Change password</ItemTitle>
          </ItemContent>
        </Item>
      </ItemGroup>

      <Separator />

      <ItemGroup>
        <SignOutAction
          trigger={(openConfirm) => (
            <Item variant="outline" render={<button type="button" onClick={openConfirm} />}>
              <ItemContent>
                <ItemTitle>Sign Out</ItemTitle>
              </ItemContent>
            </Item>
          )}
        />

        {/* A plain sign-out and "sign out everywhere else" sitting flush against each
            other with no divider is exactly the mis-tap risk web-principles.md's
            Fitts's Law section calls out by name — this internal separator is the fix,
            not relocating either action out of Account & Security. */}
        <ItemSeparator />

        <Item
          variant="outline"
          render={<button type="button" onClick={() => setRevokeStep("confirm")} />}
        >
          <ItemContent>
            <ItemTitle>Sign out of all other sessions</ItemTitle>
          </ItemContent>
        </Item>
        {revokeError && <p className="text-sm text-destructive">{revokeError}</p>}
      </ItemGroup>

      <Separator />

      <Item
        variant="outline"
        render={<button type="button" onClick={() => setDeletingAccount(true)} />}
      >
        <ItemContent>
          <ItemTitle className="text-destructive">Delete account</ItemTitle>
        </ItemContent>
      </Item>

      <AlertDialog open={confirmingPasswordChange} onOpenChange={setConfirmingPasswordChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change password?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll be redirected to reset your password by email.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmingPasswordChange(false);
                await navigate({ to: "/forgot-password" });
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={revokeStep === "confirm"}
        onOpenChange={(open) => !open && setRevokeStep("closed")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of all other sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              Other devices signed in as you will be signed out. This device stays signed in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={handleConfirmRevoke}
            >
              {revoking ? "Signing out…" : "Sign Out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={revokeStep === "success"}
        onOpenChange={(open) => !open && setRevokeStep("closed")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Signed out of all other sessions.</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setRevokeStep("closed")}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeleteAccountSheet open={deletingAccount} onOpenChange={setDeletingAccount} />
    </AppPage>
  );
}
