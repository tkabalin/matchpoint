import { playerLogout } from "@matchpoint/api-client";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { SectionLabel } from "@/components/section-label";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { SignOutAction } from "@/features/settings/sign-out-action";

import { ChangePasswordSheet } from "./change-password-sheet";

/**
 * A player's Account & Security, shaped like the coach's `settings-account.tsx`
 * but carrying only what a player actually has.
 *
 * "Change password" opens a sheet (#300) rather than the form sitting inline
 * on the page by default — Hick's Law: a player visiting mainly to sign out
 * or check what's here shouldn't land on an open password form nobody asked
 * for yet, and it's the same button-plus-sheet shape the coach's own
 * "Change password" row already is, just opening a real form instead of a
 * confirm dialog, since a player's account has no email address for the
 * coach's `/forgot-password` flow to mail a code to. Sessions offers
 * sign-out alone — `DELETE /auth/sessions` takes a coach, so there is no
 * revoke-everywhere for a player to call. No danger zone either: deleting a
 * player is the coach's action on their own roster, not something a player
 * does to themselves.
 */
export function PlayerSettingsAccount() {
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <AppPage nav={false}>
      <PageHeader
        title="Account & Security"
        back={
          <Link
            to="/me/settings"
            aria-label="Back to settings"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <SectionLabel id="player-account-password">Password</SectionLabel>
      <ItemGroup aria-labelledby="player-account-password">
        <Item
          variant="outline"
          render={<button type="button" onClick={() => setChangingPassword(true)} />}
        >
          <ItemContent>
            <ItemTitle>Change password</ItemTitle>
          </ItemContent>
        </Item>
      </ItemGroup>

      <SectionLabel id="player-account-sessions">Sessions</SectionLabel>
      <ItemGroup aria-labelledby="player-account-sessions">
        <SignOutAction
          logoutFn={playerLogout}
          description="You'll need to sign in again to access your matches."
          trigger={(openConfirm) => (
            <Item variant="outline" render={<button type="button" onClick={openConfirm} />}>
              <ItemContent>
                <ItemTitle>Sign Out</ItemTitle>
              </ItemContent>
            </Item>
          )}
        />
      </ItemGroup>

      <ChangePasswordSheet open={changingPassword} onOpenChange={setChangingPassword} />
    </AppPage>
  );
}
