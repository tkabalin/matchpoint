import type { PlayerRead, RallyStats, SquadMemberStats } from "@matchpoint/api-client";
import {
  getCurrentCoachOptions,
  getPlayerOptions,
  getPlayerOverviewOptions,
  getRallyStatsOptions,
  listPlayersOptions,
  listSquadMemberStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Anchor,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Feather,
  Flame,
  Info,
  type LucideIcon,
  PersonStanding,
  Plus,
  Search,
  Settings,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

import { AddPhotoNudge } from "@/components/add-photo-nudge";
import { AddPlayerSheet } from "@/components/add-player-sheet";
import { AppPage } from "@/components/page-shell";
import { PhotoAvatar } from "@/components/photo-avatar";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerCard } from "@/components/player-card";
import { PrimaryMatchAction } from "@/components/primary-match-action";
import { ResultDots } from "@/components/result-dots";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InstallAppNudge } from "@/components/install-app-nudge";
import { pickSquadAttention } from "@/lib/analytics/attention";
import {
  aggressionScore,
  periodResiliencePercent,
  periodWinPercent,
  pickBestWorst,
} from "@/lib/analytics/squad-stats";
import type { AttentionResult } from "@/lib/analytics/types.provisional";
import { dismissAttentionFlag, isAttentionFlagDismissed } from "@/lib/attention-flag-dismissed";
import { initialsFor } from "@/lib/coach-initials";
import { getLastViewedPlayerId, setLastViewedPlayerId } from "@/lib/last-viewed-player";
import { PATTERN_CLASS } from "@/lib/palette";
import { useInView } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";

// Past a glance, the exact roster size is already the headline numeral right
// beside these icons — an unbounded row would break layout for a large squad,
// so the visual tally caps here regardless of how many players there are.
const TALLY_CAP = 8;

export function Home() {
  const { data: coach } = useQuery(getCurrentCoachOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const { data: squadStats } = useQuery(listSquadMemberStatsOptions());
  const [search, setSearch] = useState("");
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
  const squadMembers = squadStats ?? [];
  const attention = pickSquadAttention(squadMembers);
  const findPlayer = (playerId: string) => roster.find((player) => player.id === playerId) ?? null;
  const findMember = (playerId: string) =>
    squadMembers.find((member) => member.player_id === playerId);
  // localStorage isn't itself reactive, so dismissing bumps this to force a
  // re-read of isAttentionFlagDismissed on the next render.
  const [, forceAttentionRerender] = useState(0);
  const attentionDismissed = attention
    ? isAttentionFlagDismissed(attention.playerId, attention.tier)
    : false;

  // "Most aggressive"/"most passive" have no last-5-scoped source (only
  // RallyStats.styles carries the needed opponent's-own-unforced-error split,
  // and that endpoint has no last-N-matches window) — see
  // .claude/plans/lets-tackle-issue-225-silly-giraffe.md. Scoped to each
  // player's whole history instead, same roster-wide fan-out pattern
  // player-insights-card.tsx already uses.
  const { ref: tendencyRef, inView: tendencyInView } = useInView<HTMLDivElement>();
  const rallyResults = useQueries({
    queries: roster.map((player) => ({
      ...getRallyStatsOptions({ path: { player_id: player.id } }),
      enabled: tendencyInView,
    })),
  });
  const rallyStatsById = new Map(
    roster
      .map((player, index) => [player.id, rallyResults[index]?.data] as const)
      .filter((entry): entry is [string, RallyStats] => entry[1] !== undefined),
  );

  const bestWorstWinPercent = pickBestWorst(squadMembers, (member) =>
    periodWinPercent(member.period_record),
  );
  const bestWorstResilience = pickBestWorst(squadMembers, (member) =>
    periodResiliencePercent(member),
  );
  const bestWorstFirstServe = pickBestWorst(
    squadMembers,
    (member) => member.period_first_serve_in_percent,
  );
  const membersWithAggression = squadMembers.flatMap((member) => {
    const rally = rallyStatsById.get(member.player_id);
    const aggression = rally ? aggressionScore(rally.styles) : null;
    return aggression === null ? [] : [{ member, aggression }];
  });
  const bestWorstAggression = pickBestWorst(membersWithAggression, (entry) => entry.aggression);

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
              render={
                <Link
                  to="/players/$playerId"
                  params={{ playerId: player.id }}
                  onClick={() => setLastViewedPlayerId(player.id)}
                />
              }
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
        <div className="flex items-baseline justify-between">
          <h2 id="squad-snapshot" className="text-xl font-bold">
            Squad snapshot
          </h2>
          <Link to="/stats" className="text-sm text-primary underline underline-offset-4">
            See full squad stats
          </Link>
        </div>
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
                {roster.length > 0 && (
                  <div
                    data-testid="player-tally"
                    className="flex flex-wrap items-center gap-0.5"
                    aria-hidden="true"
                  >
                    {Array.from({ length: Math.min(roster.length, TALLY_CAP) }).map((_, index) => (
                      <PersonStanding
                        key={index}
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    ))}
                    {roster.length > TALLY_CAP && (
                      <span className="text-[0.625rem] font-semibold text-muted-foreground">
                        +{roster.length - TALLY_CAP}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div ref={tendencyRef} className="flex flex-col">
              <SquadRow
                label="Best win %"
                icon={TrendingUp}
                info={WIN_PERCENT_INFO}
                member={bestWorstWinPercent.best}
                player={
                  bestWorstWinPercent.best ? findPlayer(bestWorstWinPercent.best.player_id) : null
                }
                value={
                  bestWorstWinPercent.best
                    ? periodWinPercent(bestWorstWinPercent.best.period_record)
                    : null
                }
                emptyDetail="Not enough matches logged yet."
              />
              <SquadRow
                label="Worst win %"
                icon={TrendingDown}
                info={WIN_PERCENT_INFO}
                member={bestWorstWinPercent.worst}
                player={
                  bestWorstWinPercent.worst ? findPlayer(bestWorstWinPercent.worst.player_id) : null
                }
                value={
                  bestWorstWinPercent.worst
                    ? periodWinPercent(bestWorstWinPercent.worst.period_record)
                    : null
                }
                emptyDetail="Not enough matches logged yet."
              />
              <SquadRow
                label="Steadiest"
                icon={Anchor}
                info={RESILIENCE_INFO}
                member={bestWorstResilience.best}
                player={
                  bestWorstResilience.best ? findPlayer(bestWorstResilience.best.player_id) : null
                }
                value={
                  bestWorstResilience.best
                    ? periodResiliencePercent(bestWorstResilience.best)
                    : null
                }
                emptyDetail="Not enough matches logged yet."
              />
              <SquadRow
                label="Most mistakes"
                icon={TriangleAlert}
                info={RESILIENCE_INFO}
                member={bestWorstResilience.worst}
                player={
                  bestWorstResilience.worst ? findPlayer(bestWorstResilience.worst.player_id) : null
                }
                value={
                  bestWorstResilience.worst
                    ? periodResiliencePercent(bestWorstResilience.worst)
                    : null
                }
                emptyDetail="Not enough matches logged yet."
              />
              <SquadRow
                label="Most aggressive"
                icon={Flame}
                info={AGGRESSION_INFO}
                member={bestWorstAggression.best?.member ?? null}
                player={
                  bestWorstAggression.best
                    ? findPlayer(bestWorstAggression.best.member.player_id)
                    : null
                }
                value={bestWorstAggression.best?.aggression ?? null}
                emptyDetail="Not enough rally data logged yet."
              />
              <SquadRow
                label="Most passive"
                icon={Feather}
                info={AGGRESSION_INFO}
                member={bestWorstAggression.worst?.member ?? null}
                player={
                  bestWorstAggression.worst
                    ? findPlayer(bestWorstAggression.worst.member.player_id)
                    : null
                }
                value={bestWorstAggression.worst?.aggression ?? null}
                emptyDetail="Not enough rally data logged yet."
              />
              <SquadRow
                label="Best 1st serve %"
                icon={CircleCheck}
                info={FIRST_SERVE_INFO}
                member={bestWorstFirstServe.best}
                player={
                  bestWorstFirstServe.best ? findPlayer(bestWorstFirstServe.best.player_id) : null
                }
                value={
                  bestWorstFirstServe.best
                    ? bestWorstFirstServe.best.period_first_serve_in_percent
                    : null
                }
                emptyDetail="Not enough matches logged yet."
              />
              <SquadRow
                label="Worst 1st serve %"
                icon={CircleX}
                info={FIRST_SERVE_INFO}
                member={bestWorstFirstServe.worst}
                player={
                  bestWorstFirstServe.worst ? findPlayer(bestWorstFirstServe.worst.player_id) : null
                }
                value={
                  bestWorstFirstServe.worst
                    ? bestWorstFirstServe.worst.period_first_serve_in_percent
                    : null
                }
                emptyDetail="Not enough matches logged yet."
              />
            </div>

            {/* A genuine flag to act on, not a ranking like the rows above —
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
          </CardContent>
        </Card>
      </section>

      {lastViewedPlayer && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Continue with</h2>
          <PlayerCard player={lastViewedPlayer} member={findMember(lastViewedPlayer.id)} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold">My players</h2>
          <Link to="/players" className="text-sm text-primary underline underline-offset-4">
            See all
          </Link>
        </div>
        {/* py-1, not pb-1: overflow-x-auto forces the cross axis to clip too (a
            box-shadow-based halo, unlike a border, extends outside the element's
            own box), so top padding is needed just as much as bottom to avoid
            slicing off the top of each avatar's swatch-halo ring. */}
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 py-1">
          {roster.map((player) => (
            <RosterTile key={player.id} player={player} />
          ))}
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label="Add a player"
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <span className="flex size-16 items-center justify-center rounded-sm border border-dashed text-muted-foreground">
              <Plus className="size-4" />
            </span>
            <span className="text-xs text-muted-foreground">Add</span>
          </button>
        </div>
      </section>

      <AddPlayerSheet open={adding} onOpenChange={setAdding} />
      <PrimaryMatchAction />
    </AppPage>
  );
}

// Squad-snapshot rows share these four explanations pairwise (best/worst is
// one metric, so both ends of a pair get the same text).
const WIN_PERCENT_INFO = "Wins out of matches played this season.";
const RESILIENCE_INFO =
  "Share of a player's own errors caused by the opponent, not themselves. Higher means steadier.";
const AGGRESSION_INFO =
  "Share of the opponent's errors forced by pressure, not handed over free. Higher means more aggressive.";
const FIRST_SERVE_INFO = "Share of first serves landing in play.";

/** One row of the squad snapshot's eight tendency rankings. Renders as a
 *  plain, muted line when there's no eligible player for this metric yet —
 *  an empty result here (nobody with enough data) is a legitimate outcome the
 *  row should say plainly, not paper over.
 *
 *  The label is the row's own heading, not a caption — a coach scanning this
 *  card needs to know what each row measures before the player's name means
 *  anything, so it's sized and coloured as the headline text it is, per
 *  `.claude/rules/web-stat-cards.md`'s "never text-muted-foreground on a
 *  headline label" rule (this row used to break it).
 *
 *  Goes straight to the player's stats page, matching every other tappable
 *  row here — a coach tapping a ranked row already wants the numbers behind
 *  that ranking (#225 item 6). The info-popover trigger is a true sibling of
 *  the row's own `Link`, never nested or overlaid on it — see
 *  `match-card.tsx`'s own note on why an overlay-link is the wrong tool here. */
function SquadRow({
  label,
  icon: Icon,
  info,
  member,
  player,
  value,
  emptyDetail,
}: {
  label: string;
  /** Large and distinct per row — no two rows on this card, or elsewhere on
   *  the home screen, share an icon for a different meaning. */
  icon: LucideIcon;
  /** What this row measures, shown in a tap-triggered popover — this app is
   *  touch-first, so the affordance is a tap, not a hover-only tooltip. */
  info: string;
  member: SquadMemberStats | null;
  player: PlayerRead | null;
  /** The 0–100 share that earned this player the row. Null renders the empty
   *  state rather than a fabricated figure. */
  value: number | null;
  emptyDetail: string;
}) {
  const icon = <Icon className="size-6 shrink-0 text-primary" aria-hidden="true" />;
  const display = value === null ? null : `${Math.round(value)}%`;
  const infoTrigger = (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" />}
        aria-label={`Explain ${label}`}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm" side="left">
        {info}
      </PopoverContent>
    </Popover>
  );

  const labelText = (
    <p className="text-sm font-bold tracking-wide text-foreground uppercase">{label}</p>
  );

  if (!player || !member || value === null) {
    return (
      <div
        data-testid={label}
        className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0 first:pt-0"
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {labelText}
            {infoTrigger}
          </div>
          <p className="text-xs text-muted-foreground">{emptyDetail}</p>
        </div>
      </div>
    );
  }

  // The info button has to sit beside the label it explains, not at the row's
  // edge next to the navigate-away chevron, yet it can't live inside the
  // `Link`'s <a>. So the row is a grid and the `Link` is `display: contents`:
  // its children become the grid's cells directly, and the button is a true
  // sibling dropped into the spare cell after the label. `has-*` restores the
  // focus ring an <a> without a box of its own can no longer draw.
  return (
    <div
      data-testid={label}
      className="grid grid-cols-[auto_auto_auto_1fr_auto_auto] items-center gap-x-2.5 border-t py-2.5 first:border-t-0 first:pt-0 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/30"
    >
      <Link
        to="/players/$playerId"
        params={{ playerId: player.id }}
        onClick={() => setLastViewedPlayerId(player.id)}
        className="contents"
      >
        <span className="col-start-1 row-span-3 row-start-1">{icon}</span>
        <span className="col-start-2 row-span-3 row-start-1">
          <PlayerAvatar player={player} size="sm" />
        </span>
        <span className="col-start-3 row-start-1">{labelText}</span>
        <p className="col-span-2 col-start-3 row-start-2 min-w-0 truncate text-sm font-medium">
          {`${player.first_name} ${player.last_name}`}
        </p>
        <ResultDots
          results={member.last5_results}
          className="col-span-2 col-start-3 row-start-3 mt-1"
        />
        <div className="col-start-5 row-span-3 row-start-1 flex flex-col items-end gap-1">
          <p className="text-base font-bold tabular-nums">{display}</p>
          {/* A small fixed-width bar, not a full-width one — this is a relative
           *  sense of proportion at a glance, not a chart in its own right, so
           *  it shouldn't compete with the row's name/value for width. */}
          <div className="h-1.5 w-10 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
            <div className={cn("h-full", PATTERN_CLASS.indigo)} style={{ width: `${value}%` }} />
          </div>
        </div>
        <ChevronRight
          className="col-start-6 row-span-3 row-start-1 size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
      <span className="col-start-4 row-start-1 -ml-1.5 justify-self-start">{infoTrigger}</span>
    </div>
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
        className="min-w-0 flex-1"
      >
        <ItemMedia>
          {/* CircleAlert, not TriangleAlert — TriangleAlert already means "unforced
              error" point-ender style (rally-tab.tsx) and Home's own "most mistakes"
              row above, per .claude/rules/web-icons.md's canonical registry. */}
          <CircleAlert className="size-5 text-outcome-forced" aria-hidden="true" />
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

function RosterTile({ player }: { player: PlayerRead }) {
  // The underline is a score band on form, which is what the palette rule reserves
  // these three colours for — a player with no form yet gets a neutral bar, not
  // the worst band: `0` would misreport "struggling" for "no data yet".
  const { data: overview } = useQuery(getPlayerOverviewOptions({ path: { player_id: player.id } }));
  const form = overview?.form?.value ?? null;
  const tone =
    form === null
      ? "bg-muted"
      : form >= 65
        ? "pattern-win"
        : form >= 50
          ? "pattern-forced"
          : "pattern-unforced";

  return (
    <Link
      to="/players/$playerId"
      params={{ playerId: player.id }}
      onClick={() => setLastViewedPlayerId(player.id)}
      className="flex shrink-0 flex-col items-center gap-1"
    >
      <PlayerAvatar player={player} size="xl" />
      <span className={cn("h-0.5 w-16 rounded-sm", tone)} aria-hidden="true" />
      <span className="text-xs">{player.first_name}</span>
    </Link>
  );
}
