import { ChevronRight, KeyRound, Plus, Search } from "lucide-react";
import { useState } from "react";

import { AddPlayerSheet } from "@/components/add-player-sheet";
import { AppPage, PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";

import { PlayerList } from "./player-list";
import { RedeemTransferCodeSheet } from "./redeem-transfer-code-sheet";

export function PlayersPage() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  return (
    <AppPage>
      <PageHeader title="Players" />

      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search players"
          placeholder="Search players"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </InputGroup>

      {/* Moved out of the header's icon-only corner button (#182) — an icon with no
          visible label there was hard for a new coach to find. A labelled row is a
          bigger, clearer target for a rare-but-real action. */}
      <Item variant="outline" render={<button type="button" onClick={() => setRedeeming(true)} />}>
        <ItemMedia>
          <KeyRound className="size-4" aria-hidden="true" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Have a transfer code?</ItemTitle>
        </ItemContent>
        <ItemActions>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </ItemActions>
      </Item>

      <PlayerList search={search} />

      {/* Adds a player, unlike the match list's action, which starts a match. Each
          screen's floating action does the thing that screen is about. */}
      <Button
        size="icon"
        aria-label="Add player"
        onClick={() => setAdding(true)}
        className="fixed right-[max(1rem,calc(50%-13rem))] bottom-20 z-40 size-12 rounded-full shadow-lg"
      >
        <Plus className="size-6" />
      </Button>

      <AddPlayerSheet open={adding} onOpenChange={setAdding} />
      <RedeemTransferCodeSheet open={redeeming} onOpenChange={setRedeeming} />
    </AppPage>
  );
}
