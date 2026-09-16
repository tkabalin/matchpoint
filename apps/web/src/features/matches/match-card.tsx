import type { MatchRead, PlayerRead } from "@matchpoint/api-client";
import { listPointsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, CircleX, Crown, Pencil, Trash2 } from "lucide-react";

import { PhotoAvatar } from "@/components/photo-avatar";
import { PlayerAvatar } from "@/components/player-avatar";
import { Button } from "@/components/ui/button";
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

/** The match-winner crown, reserving its slot either way so the two names'
 * columns line up whether or not this side actually won. Uses the same
 * win-outcome green a set's own tick already carries, rather than inventing a
 * "trophy gold" the color palette has no role for. */
function WinnerCrown({ won }: { won: boolean }) {
  if (!won) {
    return <Crown className="mx-auto block size-4 text-outcome-win opacity-0" aria-hidden="true" />;
  }
  return (
    <Crown className="mx-auto block size-4 text-outcome-win" role="img" aria-label="Match winner" />
  );
}

function playerName(player: Pick<PlayerRead, "first_name" | "last_name">): string {
  return `${player.first_name} ${player.last_name}`;
}

export function MatchCard({
  match,
  player,
  onEdit,
  onDelete,
}: {
  match: MatchRead;
  // Absent means the roster fetch hasn't resolved this player yet, or the id
  // no longer matches anyone on the roster — either way, a name-only avatar
  // and "Unknown player" beats silently dropping the row.
  player: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url"> | undefined;
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
    // The row and the edit/delete buttons are siblings, not nested — a button
    // inside an anchor is invalid HTML, and an earlier overlay-link version of
    // this turned out unreliable for real clicks despite passing in tests.
    <div ref={ref} className="flex items-stretch gap-1">
      <Item
        variant="outline"
        render={<Link to="/matches/$matchId" params={{ matchId: match.id }} />}
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
        // was actually doing the containing, and still does.
        className="w-full min-w-0 flex-1 overflow-hidden text-left"
      >
        <div className="flex w-full min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {player ? <PlayerAvatar player={player} size="md" /> : <NameAvatar name={ourName} />}
              <div className="min-w-0 flex-1">
                <WinnerCrown won={match.result === "win"} />
                <p className="truncate text-center text-sm font-bold text-foreground">{ourName}</p>
              </div>
            </div>
            <span className="shrink-0 text-xs font-bold text-muted-foreground">vs</span>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {/* Name before the spacer, mirroring our own side's [avatar,
                  name] order around "vs" rather than repeating it — our
                  avatar sits on the row's *outer* edge, far from "vs", so the
                  opponent's decoration (real or not) has to sit on their own
                  outer edge too. Putting the spacer first, like the first cut
                  of this fix did, put it right next to "vs" instead — vs then
                  read as centred between the two *decorations*, not the two
                  names, which is exactly the asymmetry this is meant to fix.
                  No real avatar here, deliberately: `opponent_name` is free
                  text with no linked player row, so there's never a real
                  photo behind it — an avatar box the same as our own
                  player's would imply a capability that doesn't exist. */}
              <div className="min-w-0 flex-1">
                <WinnerCrown won={match.result === "loss"} />
                <p className="truncate text-center text-sm font-bold text-foreground">
                  {opponentName}
                </p>
              </div>
              <div className="size-9 shrink-0" aria-hidden="true" />
            </div>
          </div>

          {match.result === null && (
            <p className="text-center text-xs font-semibold text-muted-foreground">
              Not finished yet, no winner
            </p>
          )}

          <div className="flex min-w-0 items-start gap-3">
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
              <div className="flex min-w-0 flex-1 items-start gap-3 overflow-x-auto">
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
                          than its neighbours' — the same "reserve the slot"
                          pattern `WinnerCrown` already uses above. */}
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
                              game.winner === "tracked"
                                ? PATTERN_CLASS.win
                                : PATTERN_CLASS.unforced,
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

            <div
              className={cn(
                "flex shrink-0 items-start gap-1",
                sets.length === 0 && "flex-1 justify-end",
              )}
            >
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-sm font-semibold text-muted-foreground">
                  {formatPlayedOn(match.played_on)}
                </span>
                {match.surface && SurfaceIcon && (
                  <span className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
                    <SurfaceIcon className="size-4 shrink-0" aria-hidden="true" />
                    {SURFACE_LABEL[match.surface]}
                  </span>
                )}
              </div>
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </Item>
      {/* Edit pinned to the top and delete to the bottom (`justify-between`
          across the full stretched height) rather than stacked together in
          the middle — the card grew tall enough that adjacent icon buttons
          read as a matched pair, raising the odds of hitting the wrong one.
          Edit stays blue (the app's reserved interactive/brand color), delete
          stays red (the same destructive tone every other delete control in
          the app uses). Offered on a completed match too: finishing one
          freezes only its result and scoring system (#228), and the sheet
          locks that one field itself rather than the row hiding the whole
          control. */}
      {(onEdit ?? onDelete) && (
        <div className="flex flex-col justify-between py-2 pr-1">
          {onEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-primary"
              aria-label={`Edit details for the match vs ${opponentName}`}
              onClick={() => onEdit(match)}
            >
              <Pencil />
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive"
              aria-label={`Delete the match vs ${opponentName}`}
              onClick={() => onDelete(match)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
