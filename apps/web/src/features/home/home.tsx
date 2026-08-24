import type { PlayerRead } from "@matchpoint/api-client";
import {
  getCurrentCoachOptions,
  getPlayerOptions,
  listMatchesOptions,
  listPlayersOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  History,
  type LucideIcon,
  Plus,
  Search,
  Settings,
  Swords,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

import { AddPhotoNudge } from "@/components/add-photo-nudge";
import { AddPlayerSheet } from "@/components/add-player-sheet";
import { AppPage } from "@/components/page-shell";
import { PhotoAvatar } from "@/components/photo-avatar";
import { PlayerActionSheet } from "@/components/player-action-sheet";
import { PlayerAvatar } from "@/components/player-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { InstallAppNudge } from "@/components/install-app-nudge";
import { pickSquadAttention, rankForm } from "@/lib/analytics/attention";
import {
  getPlayerOverviewOptions,
  getRecentFormOptions,
  squadMemberStatsFor,
} from "@/lib/analytics/analytics-options";
import type { AttentionResult } from "@/lib/analytics/types.provisional";
import { dismissAttentionFlag, isAttentionFlagDismissed } from "@/lib/attention-flag-dismissed";
import { initialsFor } from "@/lib/coach-initials";
import {
  getLastViewedAt,
  getLastViewedPlayerId,
  setLastViewedPlayerId,
} from "@/lib/last-viewed-player";
import type { OutcomeName } from "@/lib/palette";
import { relativeTimeFrom } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

export function Home() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const { data: players } = useQuery(listPlayersOptions());
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
  const squadMembers = roster.map((player, index) => squadMemberStatsFor(player.id, index));
  const formRank = rankForm(squadMembers);
  const attention = pickSquadAttention(squadMembers);
  const findPlayer = (playerId: string) => roster.find((player) => player.id === playerId) ?? null;
  // localStorage isn't itself reactive, so dismissing bumps this to force a
  // re-read of isAttentionFlagDismissed on the next render.
  const [, forceAttentionRerender] = useState(0);
  const attentionDismissed = attention
    ? isAttentionFlagDismissed(attention.playerId, attention.tier)
    : false;

  return (
    <AppPage>
      <header className="flex items-start justify-between gap-2">
        <div>
          {coach && <p className="text-sm text-muted-foreground">Welcome back</p>}
          <h1 className="text-xl font-bold">{coach ? `Coach ${coach.display_name}` : "Home"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The coach's own avatar stands in for a generic icon once it's loaded —
              bigger than Settings' icon-sm button to start with, since Jakob's Law
              (every mainstream app's own-profile control) says the header's most
              recognisable target is a face or initials, not chrome. Falls back to
              the plain icon in its old button chrome while the coach is unknown. */}
          <Link
            to="/profile"
            aria-label="Profile"
            className={cn(
              "rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              !coach && buttonVariants({ variant: "outline", size: "icon-sm" }),
            )}
          >
            {coach ? (
              <PhotoAvatar
                id={coach.id}
                initials={initialsFor(coach.display_name)}
                photoUrl={coach.photo_url}
                size="xl"
                shape="circle"
              />
            ) : (
              <UserRound />
            )}
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

      {coach && <AddPhotoNudge coach={coach} />}
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
        <div className="flex flex-col gap-2" role="list" aria-label="Search results">
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

      <section aria-labelledby="squad-snapshot" className="flex flex-col gap-2">
        <h2 id="squad-snapshot" className="text-lg font-bold">
          Squad snapshot
        </h2>
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-5">
              <div className="flex items-center gap-2">
                <Users className="size-7 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-xl font-bold tabular-nums">{roster.length}</p>
                  <p className="text-[0.625rem] text-muted-foreground">
                    {roster.length === 1 ? "player" : "players"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col">
              <SquadRow
                label="Best form"
                icon={TrendingUp}
                tone="win"
                player={formRank.best ? findPlayer(formRank.best.playerId) : null}
                detail={null}
                stats={formRank.best ?? undefined}
                emptyDetail="Not enough matches logged yet."
              />
              <SquadRow
                label="Worst form"
                icon={TrendingDown}
                tone="unforced"
                player={formRank.worst ? findPlayer(formRank.worst.playerId) : null}
                detail={null}
                stats={formRank.worst ?? undefined}
                emptyDetail="Not enough matches logged yet."
              />
            </div>

            {/* A genuine flag to act on, not a ranking like the two rows above —
                the bordered, dismissible treatment (matching AddPhotoNudge/
                InstallAppNudge) is what tells them apart, rather than the same
                plain divider-row style all three used before (#205). Renders
                nothing at all when there's nothing flagged, same as those nudges
                do when inapplicable, rather than a placeholder line. */}
            {attention && !attentionDismissed && (
              <AttentionCard
                attention={attention}
                player={findPlayer(attention.playerId)}
                onDismiss={() => {
                  dismissAttentionFlag(attention.playerId, attention.tier);
                  forceAttentionRerender((tick) => tick + 1);
                }}
              />
            )}

            <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
              Based on each player&rsquo;s last few matches. &ldquo;Needs attention&rdquo; can flag
              even your best player if their results have slipped lately.
            </p>
          </CardContent>
        </Card>
      </section>

      {lastViewedPlayer && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Continue with</h2>
          <ContinueWithCard player={lastViewedPlayer} onSelect={setSelected} />
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
            <span className="flex size-16 items-center justify-center rounded-sm border border-dashed text-muted-foreground">
              <Plus className="size-4" />
            </span>
            <span className="text-xs text-muted-foreground">Add</span>
          </button>
        </div>
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

/** Text color per outcome tone, for a row's icon — the icon's own shape is
 *  already what tells "Best form" apart from "Needs attention" at a glance
 *  (the large-and-unique-icon rule this row follows, same as the player
 *  stats screens), so color here reinforces rather than carries the meaning
 *  alone, and needs no swatch halo of its own. */
const TONE_ICON_CLASS: Record<OutcomeName, string> = {
  win: "text-outcome-win",
  unforced: "text-outcome-unforced",
  forced: "text-outcome-forced",
};

/** One row of the squad snapshot (best form / worst form / needs attention).
 *  Renders as a plain, non-interactive line in its own muted tone when there's
 *  no player to show — an empty result here (nobody eligible, nobody flagged)
 *  is a legitimate outcome the row should say plainly, not paper over.
 *
 *  Goes straight to the player's stats page, not the view/start-match sheet —
 *  a coach tapping a ranked row already wants the numbers behind that ranking,
 *  not a choice between viewing and starting a match. */
function SquadRow({
  label,
  icon: Icon,
  tone,
  player,
  detail,
  stats,
  emptyDetail,
}: {
  label: string;
  /** Large and distinct per row — no two rows on this card, or elsewhere on
   *  the home screen, share an icon for a different meaning. */
  icon: LucideIcon;
  tone: OutcomeName;
  player: PlayerRead | null;
  /** Plain caption text — used by rows without a `stats` pair (Needs attention). */
  detail: string | null;
  /** Last-5 record and forced:unforced ratio, shown as the same icon+number
   *  pair "Continue with" uses, not folded into a single line of text. */
  stats?: { last5Record: string; forcedToUnforcedRatio: number };
  emptyDetail: string;
}) {
  const icon = <Icon className={cn("size-7 shrink-0", TONE_ICON_CLASS[tone])} aria-hidden="true" />;

  if (!player || (!detail && !stats)) {
    return (
      <div className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0 first:pt-0">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-[0.5625rem] font-bold tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="text-xs text-muted-foreground">{emptyDetail}</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      to="/players/$playerId"
      params={{ playerId: player.id }}
      onClick={() => setLastViewedPlayerId(player.id)}
      className="flex w-full items-center gap-2.5 border-t py-2.5 text-left first:border-t-0 first:pt-0"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[0.5625rem] font-bold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="truncate text-sm font-semibold">{`${player.first_name} ${player.last_name}`}</p>
        {stats ? (
          <div className="mt-1 flex gap-6">
            <div className="flex items-center gap-2">
              <History className="size-7 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xl font-bold tabular-nums">{stats.last5Record}</p>
                <p className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                  Last 5
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Swords className="size-7 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xl font-bold tabular-nums">
                  {stats.forcedToUnforcedRatio.toFixed(1)}
                </p>
                <p className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                  Forced : Unforced
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** The "Needs attention" flag, once one exists — a bordered, dismissible card
 *  (#205) matching AddPhotoNudge/InstallAppNudge's visual language, since this
 *  is a genuine flag to act on rather than a ranking. The row and the dismiss
 *  button are siblings, not nested, matching MatchRow's own reasoning
 *  (match-list.tsx): a button inside a Link is invalid HTML. */
function AttentionCard({
  attention,
  player,
  onDismiss,
}: {
  attention: AttentionResult;
  player: PlayerRead | null;
  onDismiss: () => void;
}) {
  if (!player) return null;

  return (
    <div className="flex items-stretch gap-1">
      <Item
        variant="outline"
        render={
          <Link
            to="/players/$playerId"
            params={{ playerId: player.id }}
            onClick={() => setLastViewedPlayerId(player.id)}
          />
        }
        className="flex-1"
      >
        <ItemMedia>
          <TriangleAlert className="size-5 text-outcome-forced" aria-hidden="true" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{`${player.first_name} ${player.last_name}`}</ItemTitle>
          <ItemDescription>{attention.reason}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </ItemActions>
      </Item>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Dismiss the attention flag for ${player.first_name} ${player.last_name}`}
        onClick={onDismiss}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function recordFrom(results: readonly ("win" | "loss")[]): string {
  const wins = results.filter((result) => result === "win").length;
  return `${wins}–${results.length - wins}`;
}

function ContinueWithCard({
  player,
  onSelect,
}: {
  player: PlayerRead;
  onSelect: (player: PlayerRead) => void;
}) {
  const { data: overview } = useQuery(getPlayerOverviewOptions({ path: { player_id: player.id } }));
  const { data: matches } = useQuery(listMatchesOptions({ query: { player_id: player.id } }));
  const { data: recentForm } = useQuery(
    getRecentFormOptions({ path: { player_id: player.id }, query: { opponentId: null } }),
  );

  const lastMatch = matches?.[0];
  const lastViewedAt = getLastViewedAt();
  const last5 = recentForm?.results.slice(-5) ?? [];

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        {/* Opens the same View player / Start match sheet every other player
            row on this screen does — "View full stats" below stays the direct
            shortcut for someone who already knows that's what they want. */}
        <Item className="p-0" render={<button type="button" onClick={() => onSelect(player)} />}>
          <ItemMedia>
            <PlayerAvatar player={player} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{`${player.first_name} ${player.last_name}`}</ItemTitle>
            <p className="text-xs text-muted-foreground">
              {lastViewedAt !== null && `Last viewed ${relativeTimeFrom(lastViewedAt)}`}
              {lastViewedAt !== null && lastMatch && " · "}
              {lastMatch && `vs ${lastMatch.opponent_name ?? "unknown"}`}
            </p>
          </ItemContent>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Item>

        {last5.length > 0 && (
          <div className="flex gap-1">
            {last5.map((result, index) => (
              <span
                key={index}
                role="img"
                aria-label={result === "win" ? "Won" : "Lost"}
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  result === "win" ? "bg-outcome-win" : "border border-muted-foreground",
                )}
              />
            ))}
          </div>
        )}

        {overview && (
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <History className="size-7 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xl font-bold tabular-nums">{recordFrom(last5)}</p>
                <p className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                  Last 5
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Swords className="size-7 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xl font-bold tabular-nums">
                  {overview.forcedToUnforced.value.toFixed(1)}
                </p>
                <p className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                  Forced : Unforced
                </p>
              </div>
            </div>
          </div>
        )}

        <Link
          to="/players/$playerId"
          params={{ playerId: player.id }}
          onClick={() => setLastViewedPlayerId(player.id)}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          View full stats
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
      <PlayerAvatar player={player} size="xl" />
      <span className={cn("h-0.5 w-16 rounded-sm", tone)} aria-hidden="true" />
      <span className="text-xs">{player.first_name}</span>
    </button>
  );
}
