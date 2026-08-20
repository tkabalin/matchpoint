import type { PlayerRead } from "@matchpoint/api-client";
import { KeyRound, Plus, Search } from "lucide-react";
import { useState } from "react";

import { AddPlayerSheet } from "@/components/add-player-sheet";
import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerActionSheet } from "@/components/player-action-sheet";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

import { PlayerList } from "./player-list";
import { RedeemTransferCodeSheet } from "./redeem-transfer-code-sheet";

export function PlayersPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlayerRead | null>(null);
  const [adding, setAdding] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  return (
    <AppPage>
      <PageHeader
        title="Players"
        trailing={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Redeem transfer code"
            onClick={() => setRedeeming(true)}
          >
            <KeyRound />
          </Button>
        }
      />

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

      <PlayerList search={search} onSelect={setSelected} />

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

      <PlayerActionSheet
        player={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </AppPage>
  );
}
