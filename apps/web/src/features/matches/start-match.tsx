import { listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerAvatar } from "@/components/player-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Which player the match is for, asked before the setup form.
 *
 * Match setup already knows how to prefill from a player, so starting from the
 * match list (where no player is in hand yet) needs this step first.
 */
export function StartMatch() {
  const [search, setSearch] = useState("");
  const { data: players, isPending } = useQuery(listPlayersOptions());

  const term = search.trim().toLowerCase();
  const matching = (players ?? []).filter((player) =>
    `${player.first_name} ${player.last_name}`.toLowerCase().includes(term),
  );

  return (
    <AppPage nav={false}>
      <PageHeader
        title="Start a match"
        centred
        back={
          <Link
            to="/matches"
            aria-label="Back to matches"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
      />

      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search for a player"
          placeholder="Search for a player"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </InputGroup>

      <h2 className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">My players</h2>

      {isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-14 w-full" />
          ))}
        </div>
      ) : matching.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No players found</EmptyTitle>
            <EmptyDescription>Add the player first, then start their match.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {matching.map((player) => (
            <Item
              key={player.id}
              variant="outline"
              render={<Link to="/new-match/$playerId" params={{ playerId: player.id }} />}
            >
              <ItemMedia>
                <PlayerAvatar player={player} size="md" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{`${player.first_name} ${player.last_name}`}</ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </div>
      )}

      <p className="mt-auto text-xs text-muted-foreground">
        Tap a player to prefill match setup — or search for someone new.
      </p>
    </AppPage>
  );
}
