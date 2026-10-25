import type { MatchRead, PlayerRead } from "@matchpoint/api-client";
import { listPointsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CircleCheck, CircleX, Crown, EllipsisVertical, Pencil, Trash2 } from "lucide-react";

import { PhotoAvatar } from "@/components/photo-avatar";
import { PlayerAvatar } from "@/components/player-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item } from "@/components/ui/item";
import { initialsFor } from "@/lib/coach-initials";
import { blockHeight, deriveSets, GAMES_ROW_HEIGHT } from "@/lib/momentum";
import { PATTERN_CLASS } from "@/lib/palette";
import { SURFACE_ICON, SURFACE_LABEL } from "@/lib/tennis-labels";
import { useInView } from "@/lib/use-in-view";
import { cn } from "@/lib/utils";

import { formatPlayedOn } from "./match-format";

/** An initials-only avatar for our own tracked player on the rare roster
 * desync where their id no longer resolves. Never used for the opponent —
 * `opponent_name` is free text with no linked player row, so there's no photo
 * to ever fall back from, and giving them an avatar box the same as our
 * player's own would visually imply a capability that doesn't exist. */
function NameAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <PhotoAvatar
      id={name}
      initials={initialsFor(name)}
      photoUrl={null}
      size="sm"
      shape="square"
      className={className}
    />
  );
}

/** The match-winner crown. Uses the same win-outcome green a set's own tick
 * already carries, rather than inventing a "trophy gold" the color palette
 * has no role for. Unlike the stacked-above-the-name shape this replaced
 * (#292), an inline icon this much smaller than the name's own line height
 * never shifted row height whether shown or not, so there's nothing to
 * reserve a slot for — rendering `null` when nobody's won yet gives the
 * name back the width a permanent opacity-0 placeholder spent either way. */
function WinnerCrown({ won }: { won: boolean }) {
  if (!won) return null;
  return (
    <Crown className="size-4 shrink-0 text-outcome-win" role="img" aria-label="Match winner" />
  );
}

/** Our own tracked player's crown badges the avatar's corner instead of
 * sitting inline before their name (#300) — the opponent's own crown below
 * has no avatar to badge onto, so it stays inline, but freeing this one
 * inline slot on our side costs the row nothing (an absolutely-positioned
 * badge doesn't compete with the name for width) and the avatar is the one
 * thing on this card that's never free-text, so it's the one place a badge
 * can't misrepresent whose win it's marking. Same corner-overlay mechanics
 * `PhotoAvatar`'s own `editable` camera badge already uses. */
function AvatarWithCrown({ won, children }: { won: boolean; children: ReactNode }) {
  if (!won) return children;
  return (
    <div className="relative inline-block shrink-0">
      {children}
      <span
        role="img"
        aria-label="Match winner"
        className="swatch-halo absolute -top-1 -left-1 flex size-5 items-center justify-center rounded-full bg-outcome-win"
      >
        <Crown className="size-3 text-background" aria-hidden="true" />
      </span>
    </div>
  );
}

function playerName(player: Pick<PlayerRead, "first_name" | "last_name">): string {
  return `${player.first_name} ${player.last_name}`;
}

export function MatchCard({
  match,
  player,
  // The coach route by default; a player's own matches list (#273) passes
  // `/me/matches/$matchId` instead, mirroring `backTo` on the stats page
  // components that already split the same coach/player route pair.
  matchHref = "/matches/$matchId",
  onEdit,
  onDelete,
}: {
  match: MatchRead;
  // Absent means the roster fetch hasn't resolved this player yet, or the id
  // no longer matches anyone on the roster — either way, a name-only avatar
  // and "Unknown player" beats silently dropping the row.
  player: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url"> | undefined;
  matchHref?: "/matches/$matchId" | "/me/matches/$matchId";
  // Both absent is the player's own matches list (#203): a player can't edit or
  // delete a match, so the whole actions column disappears rather than rendering
  // disabled buttons nobody can use.
  onEdit?: (match: MatchRead) => void;
  onDelete?: (match: MatchRead) => void;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const opponentName = match.opponent_name ?? "Unknown opponent";
  const ourName = player ? playerName(player) : "Unknown player";
  const SurfaceIcon = match.surface ? SURFACE_ICON[match.surface] : null;

  const { data: points } = useQuery({
    ...listPointsOptions({ path: { match_id: match.id } }),
    enabled: inView,
  });
  const sets = points ? deriveSets(points, match.result !== null) : [];

  return (
    // A bordered shell wraps a header strip and the clickable row as one
    // visual card (#300): the kebab used to float above the row in its own
    // unbordered strip, which read as belonging to whichever neighbouring
    // card happened to be closer rather than to this one specifically. The
    // header strip is real structure now — date/status on an outer edge,
    // the kebab pinned to the other — so the menu reads as "this card's
    // menu" the way a title bar reads as its own window's, not as loose
    // whitespace between two cards. Kebab and row stay siblings, not nested
    // one inside the other: a button inside an anchor is invalid HTML, and
    // an earlier overlay-link version of this card was already found
    // unreliable for real clicks.
    <div ref={ref} className="overflow-hidden rounded-sm border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-sm font-semibold text-muted-foreground">
        <span className="flex items-center gap-1">
          <span>{formatPlayedOn(match.played_on)}</span>
          {match.surface && SurfaceIcon && (
            <span className="flex items-center gap-1">
              <span aria-hidden="true">·</span>
              <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />
              {SURFACE_LABEL[match.surface]}
            </span>
          )}
          {match.result === null && (
            <span className="flex items-center gap-1">
              <span aria-hidden="true">·</span>
              Not finished yet, no winner
            </span>
          )}
        </span>
        {(onEdit ?? onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="-my-1 text-muted-foreground"
                  aria-label={`Actions for the match vs ${opponentName}`}
                />
              }
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(match)}>
                  <Pencil className="text-primary" />
                  Edit
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(match)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Item
        variant="default"
        render={<Link to={matchHref} params={{ matchId: match.id }} />}
        // `Item`'s own base class is a flex row (`item.tsx`), and this is the
        // one shape that trips a real mobile WebKit bug: a single full-width
        // flex-col child, several layers above the sets strip's own
        // `overflow-x-auto`. Relying on that div alone to establish "auto min
        // size → 0" up the whole chain holds on desktop Chromium/Firefox but
        // not reliably on iOS Safari — min-w-0 has to be explicit at every
        // level between here and there, not just where the scrolling happens.
        // `overflow-hidden` on top of that is a hard clip rather than a flex
        // sizing hint: it holds regardless of whether WebKit's min-width
        // propagation quirk shows up again somewhere else in this chain. It
        // belongs here only, not on the padding-free wrapper div below: that
        // one clipped the avatar's own halo ring at the card's edge, since it
        // has no clearance of its own to lose — Item's real padding is what
        // was actually doing the containing, and still does. `variant="default"`
        // (a transparent border) rather than `outline`: the shell above already
        // draws this card's one visible border, so Item's own would double it
        // up along the three edges they share.
        className="w-full min-w-0 overflow-hidden rounded-none text-left"
      >
        <div className="flex w-full min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <AvatarWithCrown won={match.result === "win"}>
                {player ? (
                  <PlayerAvatar player={player} size="md" />
                ) : (
                  <NameAvatar name={ourName} />
                )}
              </AvatarWithCrown>
              <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-foreground">
                {ourName}
              </p>
            </div>
            <span className="shrink-0 text-xs font-bold text-muted-foreground">vs</span>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {/* Name before the spacer, mirroring our own side's [avatar,
                  name] order around "vs" rather than repeating it — our
                  avatar sits on the row's *outer* edge, far from "vs", so the
                  opponent's decoration (real or not) has to sit on their own
                  outer edge too. The spacer matches the avatar's own
                  footprint exactly (not the avatar-plus-crown-badge one,
                  since the badge is an overlay that costs the row no width
                  of its own), which is what keeps "vs" centred. No real
                  avatar here, deliberately: `opponent_name` is free text
                  with no linked player row, so there's never a real photo
                  behind it — an avatar box the same as our own player's
                  would imply a capability that doesn't exist. Their own
                  crown stays inline rather than badging anything, for the
                  same reason: there's no avatar on this side to badge. */}
              <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
                <WinnerCrown won={match.result === "loss"} />
                <p className="truncate text-sm font-bold text-foreground">{opponentName}</p>
              </div>
              <div className="size-9 shrink-0" aria-hidden="true" />
            </div>
          </div>

          {sets.length > 0 && (
            // Each set is one column — its score sits directly above its own
            // momentum group rather than two separately-centred rows, which
            // only stayed aligned by accident (a score's text width and its
            // momentum group's width rarely match, so two independent
            // `justify-center` rows drift apart as more sets are added).
            // `min-w-0` lets this flex-1 child actually shrink below its
            // content's width so `overflow-x-auto` can do its job instead of
            // forcing the whole card wider once sets stop fitting.
            // `items-start`: with no explicit cross-axis alignment this
            // defaults to `stretch`, which forces every set-group column to
            // the height of the tallest one — and since a flex-col's content
            // packs at the top by default, a set with a short/quiet game
            // then floats near the top of an artificially taller column
            // instead of sharing the bottom baseline with its neighbours,
            // reading as a bar that's "cut off" partway up.
            <div className="flex min-w-0 items-start gap-3 overflow-x-auto">
              {sets.map((set, index) => (
                <div
                  key={set.setNumber}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-1.5",
                    index > 0 && "border-l border-muted-foreground/30 pl-3",
                  )}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-sm font-bold text-foreground tabular-nums">
                      {set.tracked}–{set.opponent}
                    </span>
                    {/* Always mounted, opacity-toggled rather than
                          conditionally rendered: a set genuinely still in
                          progress (no winner yet) must reserve the exact same
                          height this icon takes up in a finished one, or its
                          shorter score block floats its momentum bars higher
                          than its neighbours'. Each set sits in its own
                          column with nothing beside it competing for width,
                          unlike the match-level `WinnerCrown` above — there's
                          no truncation budget here for a reserved icon to
                          cost. */}
                    {set.winner === "tracked" ? (
                      <CircleCheck
                        className="size-4 text-outcome-win"
                        role="img"
                        aria-label={`Won set ${set.setNumber}`}
                      />
                    ) : set.winner === "opponent" ? (
                      <CircleX
                        className="size-4 text-outcome-unforced"
                        role="img"
                        aria-label={`Lost set ${set.setNumber}`}
                      />
                    ) : (
                      <CircleX className="size-4 opacity-0" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex items-end gap-0.5" style={{ height: GAMES_ROW_HEIGHT }}>
                    {set.games.map((game) => (
                      <div key={game.gameNumber} className="flex flex-col items-center">
                        <span
                          className={cn(
                            "mb-0.5 size-1 rounded-full bg-foreground",
                            game.isBreak ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden="true"
                        />
                        <div
                          className={cn(
                            "w-1.5 rounded-t-sm",
                            game.winner === "tracked" ? PATTERN_CLASS.win : PATTERN_CLASS.unforced,
                          )}
                          style={{ height: blockHeight(game.pointsPlayed) }}
                          aria-hidden="true"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Item>
    </div>
  );
}
