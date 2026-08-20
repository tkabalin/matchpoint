import { revokeOtherSessions } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
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
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";

import { SignOutAction } from "./sign-out-action";
import { StubRow } from "./stub-row";

type RevokeStep = "closed" | "confirm" | "success";

/**
 * Account & Security (#178, wireframe 1c). Change password now leaves Settings
 * entirely — it links to `/forgot-password` (the existing email-OTP flow) instead
 * of the old in-settings current/new/confirm form, a deliberate scope decision:
 * that flow doesn't ask for the current password and can end with the coach
 * needing to sign back in, unlike the form it replaces.
 */
export function SettingsAccount() {
  const [revokeStep, setRevokeStep] = useState<RevokeStep>("closed");
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

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
        <Item variant="outline" render={<Link to="/forgot-password" />}>
          <ItemContent>
            <ItemTitle>Change password</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
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

      <StubRow label="Delete account" danger />

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
    </AppPage>
  );
}
