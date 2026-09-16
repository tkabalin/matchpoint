import type { PlayerRead, RallyStats, Surface } from "@matchpoint/api-client";
import { getRallyStatsOptions } from "@matchpoint/api-client/react-query";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Anchor, Crosshair, Feather, Flame, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import type { PointerEvent } from "react";
import { useRef, useState } from "react";

import { PlayerAvatar } from "@/components/player-avatar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  aggressionScore,
  mistakeResilience,
  overallAverageRallyLength,
  rallyLengthSizeBucket,
  scaleToGroupRange,
} from "@/lib/analytics/squad-stats";
import { useInView } from "@/lib/use-in-view";

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.5;

/** How far the zoomed content may pan before its own edge would enter the
 *  box: at scale `s`, a box of size `size` overflows by `(s-1)/2 * size` on
 *  each side once centred, so panning past that would open a gap instead of
 *  showing more content. */
function clampPan(value: number, scale: number, size: number): number {
  const max = ((scale - 1) / 2) * size;
  return Math.min(max, Math.max(-max, value));
}

interface PlottablePlayer {
  player: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url">;
  aggression: number;
  resilience: number;
  rallyLength: number | null;
}

/** Every player with both axis scores computable, each paired with its own
 *  `RallyStats` result. A player with no rally-ending points recorded yet
 *  (both counts zero on either axis) is left out entirely rather than
 *  plotted at a fabricated center point. This app never invents a data
 *  point it doesn't have. */
function plottablePlayers(
  players: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url">[],
  rallyStatsById: Map<string, RallyStats>,
): PlottablePlayer[] {
  const plottable: PlottablePlayer[] = [];
  for (const player of players) {
    const rally = rallyStatsById.get(player.id);
    if (!rally) continue;
    const aggression = aggressionScore(rally.styles);
    const resilience = mistakeResilience(rally.styles);
    if (aggression === null || resilience === null) continue;
    plottable.push({
      player,
      aggression,
      resilience,
      rallyLength: overallAverageRallyLength(rally),
    });
  }
  return plottable;
}

/**
 * A 2D grid plotting each roster player by two scores derived from their own
 * `RallyStats.styles` (see `.claude/plans/lets-tackle-issue-225-silly-giraffe.md`
 * for why `styles.you`/`.opponents` map to these the way they do, not the
 * other way around):
 *
 * - Aggression (X): share of the tracked player's *winning* points that came
 *   from forcing the opponent into an error, rather than the opponent
 *   handing it over unforced.
 * - Mistake resilience (Y): share of the tracked player's own errors, on
 *   points they *lost*, that were forced upon them rather than their own
 *   unforced mistake.
 *
 * Both axes plot each player's score relative to the plotted group's own
 * min/max (`scaleToGroupRange`), not the raw 0-100 value, since a squad
 * clustered tightly on one axis would otherwise render as overlapping
 * avatars. The four axis-end labels (Passive/Aggressive/Steady & clean/High
 * mistakes), each with its own icon, live outside the bordered plot box's
 * own 0-100% coordinate space entirely, so an avatar can never render on top
 * of one.
 *
 * A third dimension rides on top: avatar size scales with the player's own
 * overall average rally length, relative to the plotted group's own spread,
 * never an absolute threshold.
 */
export function PlayerInsightsCard({
  players,
  surface,
}: {
  players: Pick<PlayerRead, "id" | "first_name" | "last_name" | "photo_url">[];
  surface?: Surface;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  // Pinch-zoom and pan for the plot box, so a coach can zoom into a cluster of
  // overlapping avatars on a crowded squad rather than only tapping blind. The
  // box's own ref is for its bounding rect (pan clamping), separate from the
  // in-view observer's ref above.
  const boxRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // `anchor` is the content-space point sitting under the pinch's midpoint at
  // the moment the second finger touched down. `distance`/`scale` are that
  // same starting moment's own values, both held fixed for the whole
  // gesture — each move computes the new scale as one ratio against this
  // fixed baseline (never against the previous move), the same reasoning
  // `dragStart` already uses for panning, so nothing can drift from
  // recomputing a ratio against a ratio. Re-solving pan for the fixed anchor
  // at the pinch's *current* midpoint on every move is what keeps the spot
  // between the coach's fingers under their fingers as they zoom, the same
  // way a native pinch behaves, rather than always zooming toward the box's
  // centre regardless of where they pinched.
  const pinchStart = useRef<{
    distance: number;
    scale: number;
    anchor: { x: number; y: number };
  } | null>(null);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  function pointerDistance(): number {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }

  function pointerMidpoint(): { x: number; y: number } {
    const [a, b] = [...pointers.current.values()];
    return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    // Optional on the method itself, not just the ref: jsdom's element type
    // doesn't implement Pointer Capture at all, unlike every real browser.
    boxRef.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const box = boxRef.current?.getBoundingClientRect();
    if (pointers.current.size === 2 && box) {
      dragStart.current = null;
      const mid = pointerMidpoint();
      // Solving screenPos = boxCentre + pan + scale * contentPos for
      // contentPos, at the pan/scale this gesture is starting from.
      pinchStart.current = {
        distance: pointerDistance(),
        scale,
        anchor: {
          x: (mid.x - (box.left + box.width / 2) - pan.x) / scale,
          y: (mid.y - (box.top + box.height / 2) - pan.y) / scale,
        },
      };
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;

    if (pointers.current.size === 2 && pinchStart.current) {
      const { distance, scale: startScale, anchor } = pinchStart.current;
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, startScale * (pointerDistance() / distance)),
      );
      const mid = pointerMidpoint();
      // Re-solving pan for the fixed anchor, at the midpoint's current
      // position: this is what keeps that content point under the fingers
      // as both the pinch (scale) and any two-finger drag (the midpoint
      // itself moving) happen together, exactly as a native pinch does.
      setScale(nextScale);
      setPan({
        x: clampPan(
          mid.x - (box.left + box.width / 2) - nextScale * anchor.x,
          nextScale,
          box.width,
        ),
        y: clampPan(
          mid.y - (box.top + box.height / 2) - nextScale * anchor.y,
          nextScale,
          box.height,
        ),
      });
    } else if (pointers.current.size === 1 && dragStart.current && scale > MIN_SCALE) {
      const start = dragStart.current;
      setPan({
        x: clampPan(start.panX + (e.clientX - start.x), scale, box.width),
        y: clampPan(start.panY + (e.clientY - start.y), scale, box.height),
      });
    }
  }

  function endPointer(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    pinchStart.current = null;
    dragStart.current =
      pointers.current.size === 1
        ? {
            x: [...pointers.current.values()][0]!.x,
            y: [...pointers.current.values()][0]!.y,
            panX: pan.x,
            panY: pan.y,
          }
        : null;
  }

  function zoomIn() {
    setScale((current) => Math.min(MAX_SCALE, current + ZOOM_STEP));
  }

  function zoomOut() {
    setScale((current) => {
      const next = Math.max(MIN_SCALE, current - ZOOM_STEP);
      if (next === MIN_SCALE) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  const results = useQueries({
    queries: players.map((player) => ({
      ...getRallyStatsOptions({ path: { player_id: player.id }, query: { surface } }),
      enabled: inView,
    })),
  });

  // Not yet observed counts as pending, not as answered: the queries are gated on
  // `inView`, so until the observer fires there is no data and no request either,
  // and the empty state below would claim there is nothing to plot.
  const isPending = !inView || results.some((result) => result.isPending);
  const rallyStatsById = new Map(
    players
      .map((player, index) => [player.id, results[index]?.data] as const)
      .filter((entry): entry is [string, RallyStats] => entry[1] !== undefined),
  );

  const plotted = plottablePlayers(players, rallyStatsById);
  // Every non-plotted player, whichever reason: no rally data yet, both axis
  // counts still zero, or (rarely) that one player's request failing outright.
  // All read the same to a coach as "nothing to show for them yet".
  const excludedCount = players.length - plotted.length;
  const rallyLengths = plotted
    .map((entry) => entry.rallyLength)
    .filter((value): value is number => value !== null);
  const minRallyLength = rallyLengths.length > 0 ? Math.min(...rallyLengths) : 0;
  const maxRallyLength = rallyLengths.length > 0 ? Math.max(...rallyLengths) : 0;
  // Position is scaled to the plotted group's own aggression/resilience range
  // (see scaleToGroupRange), not the raw 0-100 score, since a squad clustered
  // tightly on one axis would otherwise render as overlapping avatars.
  const aggressions = plotted.map((entry) => entry.aggression);
  const resiliences = plotted.map((entry) => entry.resilience);
  const minAggression = aggressions.length > 0 ? Math.min(...aggressions) : 0;
  const maxAggression = aggressions.length > 0 ? Math.max(...aggressions) : 0;
  const minResilience = resiliences.length > 0 ? Math.min(...resiliences) : 0;
  const maxResilience = resiliences.length > 0 ? Math.max(...resiliences) : 0;

  return (
    <StatCard>
      <div className="flex items-center gap-2">
        <Crosshair className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold text-foreground">Player insights</h3>
      </div>

      <div ref={ref}>
        {isPending ? (
          <Skeleton className="aspect-square w-full" />
        ) : plotted.length === 0 ? (
          <p className="flex aspect-square w-full items-center justify-center text-center text-xs text-muted-foreground">
            Not enough rally data logged yet to plot player insights.
          </p>
        ) : (
          // The axis labels below live in their own dedicated rows/columns
          // outside the bordered plot box, never inside its 0-100% coordinate
          // space, so an avatar positioned anywhere in the box can then never
          // overlap the label text, by construction, regardless of how the
          // group's own scores happen to be scaled.
          <div className="flex items-stretch gap-2">
            <div className="flex w-8 shrink-0 flex-col items-center justify-center gap-1">
              <Feather className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="[writing-mode:vertical-rl] rotate-180 text-center text-xs font-bold whitespace-nowrap text-muted-foreground uppercase">
                Passive
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="flex items-center justify-center gap-1 text-center text-xs font-bold text-muted-foreground uppercase">
                <Anchor className="size-4 shrink-0" aria-hidden="true" />
                Steady &amp; clean
              </span>
              <div
                ref={boxRef}
                className="relative aspect-square w-full touch-none overflow-hidden rounded-sm border-2 border-muted-foreground/50"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
              >
                {/* The frame above stays fixed; only this inner layer pans and
                    scales, so zooming reads as looking closer into the same
                    plot rather than the box itself growing. Sized to exactly
                    fill the frame (not just `inset-0`'s default) so the
                    avatars' own `left`/`top` percentages keep resolving
                    against the frame's real size regardless of the
                    transform, which only affects painting, not layout. */}
                <div
                  className="absolute inset-0"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                    transformOrigin: "center center",
                  }}
                >
                  <div
                    className="absolute inset-x-0 top-1/2 h-0.5 bg-muted-foreground/40"
                    aria-hidden="true"
                  />
                  <div
                    className="absolute inset-y-0 left-1/2 w-0.5 bg-muted-foreground/40"
                    aria-hidden="true"
                  />

                  {plotted.map(({ player, aggression, resilience, rallyLength }) => {
                    const left = scaleToGroupRange(aggression, minAggression, maxAggression);
                    const top = 100 - scaleToGroupRange(resilience, minResilience, maxResilience);
                    return (
                      <Link
                        key={player.id}
                        to="/players/$playerId"
                        params={{ playerId: player.id }}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${left}%`, top: `${top}%` }}
                        aria-label={`${player.first_name} ${player.last_name}'s player insights`}
                      >
                        <PlayerAvatar
                          player={player}
                          size={
                            rallyLength === null
                              ? "md"
                              : rallyLengthSizeBucket(rallyLength, minRallyLength, maxRallyLength)
                          }
                        />
                      </Link>
                    );
                  })}
                </div>

                <div className="absolute top-1 right-1 flex gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Zoom in on player insights"
                    disabled={scale >= MAX_SCALE}
                    onClick={zoomIn}
                  >
                    <ZoomIn />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Zoom out on player insights"
                    disabled={scale <= MIN_SCALE}
                    onClick={zoomOut}
                  >
                    <ZoomOut />
                  </Button>
                </div>
              </div>
              <span className="flex items-center justify-center gap-1 text-center text-xs font-bold text-muted-foreground uppercase">
                <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                High mistakes
              </span>
            </div>
            <div className="flex w-8 shrink-0 flex-col items-center justify-center gap-1">
              <Flame className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="[writing-mode:vertical-rl] text-center text-xs font-bold whitespace-nowrap text-muted-foreground uppercase">
                Aggressive
              </span>
            </div>
          </div>
        )}
      </div>

      <ul className="list-disc space-y-1 pl-4 text-xs font-semibold text-foreground marker:text-muted-foreground">
        <li>Right means more aggressive: forcing more errors from the opponent.</li>
        <li>Higher means steadier: fewer of their own mistakes.</li>
        <li>Bigger icon means longer rallies.</li>
      </ul>
      <p className="text-[0.625rem] text-muted-foreground">
        Scaled to this squad so similar scores don&apos;t overlap.
        {excludedCount > 0 &&
          ` ${excludedCount} ${excludedCount === 1 ? "player" : "players"} not shown. No rally data logged yet.`}
      </p>
    </StatCard>
  );
}
