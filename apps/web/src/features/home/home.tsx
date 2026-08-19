import type { PlayerRead } from "@matchpoint/api-client";
import {
  getCurrentCoachOptions,
  getPlayerOptions,
  listMatchesOptions,
  listPlayersOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Search, Settings, UserRound } from "lucide-react";
import { useState } from "react";

import { AddPlayerSheet } from "@/components/add-player-sheet";
import { BulletBar } from "@/components/bullet-bar";
import { OutcomeSwatch } from "@/components/outcome-swatch";
import { AppPage } from "@/components/page-shell";
import { PlayerActionSheet } from "@/components/player-action-sheet";
import { PlayerAvatar } from "@/components/player-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { InProgressBanner } from "@/components/in-progress-banner";
import { InstallAppNudge } from "@/components/install-app-nudge";
import { metricToBullet } from "@/lib/analytics/format";
import type { AttentionFlag, Metric } from "@/lib/analytics/types.provisional";
import {
  getPlayerOverviewOptions,
  listAttentionFlagsOptions,
} from "@/lib/analytics/analytics-options";
import { getLastViewedPlayerId, setLastViewedPlayerId } from "@/lib/last-viewed-player";
import { cn } from "@/lib/utils";

const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

// `played_on` is a plain calendar date, which `new Date(str)` reads as UTC midnight:
// east of UTC that puts a match played today in the future, dropping it from the count
// until local mid-morning. Both dates are built locally and compared as whole days.
function isWithinTheLastWeek(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const playedOn = new Date(year!, month! - 1, day!);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = Math.round((today.getTime() - playedOn.getTime()) / MILLISECONDS_PER_DAY);
  return daysAgo >= 0 && daysAgo <= 7;
}

export function Home() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const { data: allMatches } = useQuery(listMatchesOptions());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlayerRead | null>(null);
  const [adding, setAdding] = useState(false);

  const lastViewedPlayerId = getLastViewedPlayerId();
  // No error branch on purpose: a stale id in localStorage (deleted player, or a
  // different coach on a shared device) should quietly drop the card, not put a
  // "not found" on the home screen for something nobody asked to see (#78).
  const { data: lastViewedPlayer } = useQuery({
    ...getPlayerOptions({ path: { player_id: lastViewedPlayerId ?? "" } }),
    enabled: lastViewedPlayerId !== null,
  });

  const roster = players ?? [];
  const searchResults = roster.filter((player) =>
    `${player.first_name} ${player.last_name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const { data: flags } = useQuery(listAttentionFlagsOptions());
  const flagged = flags ?? [];
  const matchesThisWeek = (allMatches ?? []).filter((match) =>
    isWithinTheLastWeek(match.played_on),
  ).length;

  return (
    <AppPage>
      <header className="flex items-start justify-between gap-2">
        <div>
          {coach && <p className="text-sm text-muted-foreground">Welcome back</p>}
          <h1 className="text-xl font-bold">{coach ? `Coach ${coach.display_name}` : "Home"}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to="/profile"
            aria-label="Profile"
            className={buttonVariants({ variant: "outline", size: "icon-sm" })}
          >
            <UserRound />
          </Link>
          <Link
            to="/settings"
            aria-label="Settings"
            className={buttonVariants({ variant: "outline", size: "icon-sm" })}
          >
            <Settings />
          </Link>
        </div>
      </header>

      <InProgressBanner />
      {coach && <InstallAppNudge />}

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

      {search !== "" && (
        <div className="flex flex-col gap-2">
          {searchResults.length === 0 && <p className="text-muted-foreground">No players found.</p>}
          {searchResults.map((player) => (
            <Item
              key={player.id}
              variant="outline"
              render={<button type="button" onClick={() => setSelected(player)} />}
              className="w-full text-left"
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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm text-muted-foreground">Needs attention</h2>
        {flagged.length === 0 ? (
          // Empty until trend flagging is real. The wireframe shows this populated,
          // but the cards state a finding about a named player ("double faults up
          // 40%"), and inventing one of those is worse than showing nothing (#158).
          <p className="text-sm text-muted-foreground">No flagged trends yet.</p>
        ) : (
          // Scrolls sideways rather than wrapping: the flagged list is a glanceable
          // queue, and letting it grow downwards would push the roster off-screen.
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {flagged.map((flag) => {
              const player = roster.find((candidate) => candidate.id === flag.playerId);
              return player ? (
                <AttentionCard
                  key={flag.playerId}
                  player={player}
                  flag={flag}
                  onSelect={setSelected}
                />
              ) : null;
            })}
          </div>
        )}
      </section>

      {lastViewedPlayer && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm text-muted-foreground">Last viewed player</h2>
          <LastViewedCard player={lastViewedPlayer} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">My players</h2>
          <Link to="/players" className="text-sm text-primary underline underline-offset-4">
            See all
          </Link>
        </div>
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
          {roster.map((player) => (
            <RosterTile key={player.id} player={player} onSelect={setSelected} />
          ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <span className="flex size-11 items-center justify-center rounded-sm border border-dashed text-muted-foreground">
              <Plus className="size-4" />
            </span>
            <span className="text-xs text-muted-foreground">Add</span>
          </button>
        </div>
      </section>

      <section aria-labelledby="squad-snapshot">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <h2
              id="squad-snapshot"
              className="text-[0.625rem] tracking-wide text-muted-foreground uppercase"
            >
              Squad snapshot
            </h2>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Snapshot value={roster.length} label="Players" />
              <Snapshot value={matchesThisWeek} label="Matches this week" />
              <Snapshot value={flagged.length} label="Need attention" tone="alert" />
            </dl>
          </CardContent>
        </Card>
      </section>

      <PlayerActionSheet
        player={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      <AddPlayerSheet open={adding} onOpenChange={setAdding} />
    </AppPage>
  );
}

function Snapshot({ value, label, tone }: { value: number; label: string; tone?: "alert" }) {
  return (
    // <dt> before <dd> is what pairs each value with its own label for assistive
    // tech — a <dd> describes the *preceding* <dt>, so the reverse order would pair
    // every number with the previous tile's label. flex-col-reverse keeps the
    // value-on-top look without reordering the actual markup.
    <div className="flex flex-col-reverse">
      <dt className="text-[0.625rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "alert" && value > 0 && "text-outcome-unforced",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function AttentionCard({
  player,
  flag,
  onSelect,
}: {
  player: PlayerRead;
  flag: AttentionFlag;
  onSelect: (player: PlayerRead) => void;
}) {
  return (
    <Card className="w-40 shrink-0">
      <CardContent className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onSelect(player)}
          className="flex items-center gap-2 text-left"
        >
          <PlayerAvatar player={player} size="sm" />
          <span className="truncate text-xs font-bold">{player.first_name}</span>
        </button>
        <div className="flex gap-1">
          {flag.recentResults.map((result, index) => (
            <OutcomeSwatch
              key={index}
              size="sm"
              pattern={result === "win" ? "win" : "unforced"}
              label={result === "win" ? "W" : "L"}
            />
          ))}
        </div>
        <p className="text-[0.625rem] text-outcome-unforced">{flag.reason}</p>
      </CardContent>
    </Card>
  );
}

/** The three headline numbers, as a W–L record rather than a bare percentage. */
function recordMetric(wins: number, losses: number): Metric {
  const played = wins + losses;
  return {
    label: "W–L (season)",
    value: played === 0 ? 0 : (wins / played) * 100,
    unit: "percent",
    sampleSize: `n=${played}`,
    baseline: null,
    delta: null,
    max: 100,
    higherIsBetter: true,
    display: `${wins}–${losses}`,
  };
}

function LastViewedCard({ player }: { player: PlayerRead }) {
  const { data: overview } = useQuery(getPlayerOverviewOptions({ path: { player_id: player.id } }));
  const { data: matches } = useQuery(listMatchesOptions({ query: { player_id: player.id } }));

  const lastMatch = matches?.[0];

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Item
          className="p-0"
          render={
            <Link
              to="/players/$playerId"
              params={{ playerId: player.id }}
              onClick={() => setLastViewedPlayerId(player.id)}
            />
          }
        >
          <ItemMedia>
            <PlayerAvatar player={player} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{`${player.first_name} ${player.last_name}`}</ItemTitle>
            <ItemDescription>
              {lastMatch
                ? `Last match: vs ${lastMatch.opponent_name ?? "unknown"}`
                : "No matches yet"}
            </ItemDescription>
          </ItemContent>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Item>

        {overview && (
          <>
            <BulletBar {...metricToBullet(overview.form)} />
            <BulletBar {...metricToBullet(overview.holdPercentage)} />
            <BulletBar
              {...metricToBullet(
                recordMetric(overview.seasonRecord.wins, overview.seasonRecord.losses),
              )}
            />
          </>
        )}

        <Link
          to="/players/$playerId"
          params={{ playerId: player.id }}
          onClick={() => setLastViewedPlayerId(player.id)}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          View full profile
        </Link>
      </CardContent>
    </Card>
  );
}

function RosterTile({
  player,
  onSelect,
}: {
  player: PlayerRead;
  onSelect: (player: PlayerRead) => void;
}) {
  // The underline is a score band on form, which is what the palette rule reserves
  // these three colours for.
  const { data: overview } = useQuery(getPlayerOverviewOptions({ path: { player_id: player.id } }));
  const form = overview?.form.value ?? 0;
  const tone = form >= 65 ? "pattern-win" : form >= 50 ? "pattern-forced" : "pattern-unforced";

  return (
    <button
      type="button"
      onClick={() => onSelect(player)}
      className="flex shrink-0 flex-col items-center gap-1"
    >
      <PlayerAvatar player={player} />
      <span className={cn("h-0.5 w-11 rounded-sm", tone)} aria-hidden="true" />
      <span className="text-xs">{player.first_name}</span>
    </button>
  );
}
