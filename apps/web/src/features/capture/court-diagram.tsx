/**
 * The court six of the capture screens tap on — serve, return, final ball, rally length,
 * ending and final shot differ only in which zones sit over the same diagram, so the
 * diagram is built once and parameterised by them rather than redrawn per screen.
 *
 * Line and zone percentages are copied verbatim from the capture flow design
 * handoff, which scaled them off a real doubles court.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { zoomScale } from "./court-geometry";

// A zone flashes before the flow advances, so the coach sees which zone registered
// without looking up from the match. Local only — a timer, never a promise, per
// .claude/rules/web-capture.md.
const FLASH_MS = 420;

// The camera move into `zoomTo`, once the final ball names which region the rest of the
// point's questions live in. Slower than the tap flash above: a flash says "this tap
// registered", the zoom says "we're now working in this part of the court", and the two
// need to read as different kinds of motion. Exported so a screen animating its own exit
// (final-shot-screen.tsx's zoom back out) can time a delayed dispatch to match, rather
// than a second, hand-copied number drifting from this one.
export const ZOOM_MS = 480;
const ZOOM_EASE = "cubic-bezier(0.4, 0, 0.2, 1)"; // --ease-standard, see court-diagram's own uses below

/** Percentage geometry, positioned against the court layer. */
export interface CourtBox {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  width?: string;
  height?: string;
}

/**
 * A rectangle in the court's own 0-100 percentage space, as numbers rather than the CSS
 * strings `CourtBox` uses — the shape `zoomTo` and `court-geometry.ts`'s helpers work in,
 * since it's what a "zoom into this box" calculation needs to do arithmetic on.
 */
export interface CourtRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The real left/top/width/height — not a transform — that makes `region` fill the
 * diagram at `zoomScale(region)`, as percentages of court-surface's own frame (which
 * never itself resizes — see zoom-layer's own comment in `CourtDiagram` for why the
 * zoom is real layout rather than a transform).
 */
function zoomBox(region: CourtRegion): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const scale = zoomScale(region);
  const cx = (region.left + region.width / 2) / 100;
  const cy = (region.top + region.height / 2) / 100;
  // Percentages of court-surface's own fixed frame, which is what lets this be pure
  // arithmetic on 0-1 fractions rather than needing the frame's rendered pixel size.
  const left = (0.5 - cx * scale) * 100;
  const top = (0.5 - cy * scale) * 100;
  return {
    left: `${String(left)}%`,
    top: `${String(top)}%`,
    width: `${String(scale * 100)}%`,
    height: `${String(scale * 100)}%`,
  };
}

/**
 * Which tint a zone flashes and hovers with: `out` for a ball that missed, `in` for one
 * that landed, `court` for a zone that is neither (the final ball's two halves).
 */
export type CourtZoneTone = "in" | "out" | "court";

export interface CourtTapZone {
  /** The zone's accessible name, and its React key. */
  name: string;
  box: CourtBox;
  tone: CourtZoneTone;
  /** Painted on the court itself, e.g. "Deuce". Omitted where the zone reads from its position. */
  label?: string;
  labelPlacement?: "center" | "top" | "bottom";
  /** Vertical labels read bottom-up in the left gutter, top-down in the right one. */
  labelOrientation?: "horizontal" | "vertical-up" | "vertical-down";
  onTap: () => void;
}

// The handoff gives these as color-mix against transparent; an opacity modifier on the
// token is the same tint and keeps the color itself a token.
const ZONE_TONES: Record<CourtZoneTone, { idle: string; flash: string }> = {
  out: { idle: "hover:bg-destructive/18", flash: "bg-destructive/28" },
  in: { idle: "hover:bg-white/15", flash: "bg-white/30" },
  court: { idle: "hover:bg-court/12", flash: "bg-court/30" },
};

const LABEL_PLACEMENTS = {
  center: "items-center justify-center",
  top: "items-start justify-center pt-[20%]",
  bottom: "items-end justify-center pb-[6%]",
} as const;

const LABEL_ORIENTATIONS = {
  horizontal: "",
  "vertical-up": "[writing-mode:vertical-rl] rotate-180",
  "vertical-down": "[writing-mode:vertical-rl]",
} as const;

/**
 * The band of buttons under the court, one fixed height on every capture screen.
 *
 * The court is whatever height is left after it, so a screen carrying a taller band
 * would silently get a smaller court than the screen before it — which is what made the
 * court change size tap to tap. Columns are equal and counted from the children.
 */
export const COURT_ACTIONS =
  "mt-2 grid h-11 flex-none grid-flow-col auto-cols-fr gap-2 [&>button]:h-full";

// The doubles court: sidelines, baselines, service lines, centre service line.
const COURT_LINES: CourtBox[] = [
  { left: "15.76%", top: "6.2%", width: "3.03%", height: "87.6%" },
  { left: "81.21%", top: "6.2%", width: "3.03%", height: "87.6%" },
  { left: "15.76%", right: "15.76%", top: "6.2%", height: "1.5%" },
  { left: "15.76%", right: "15.76%", bottom: "6.2%", height: "1.5%" },
  { left: "17.27%", top: "25.93%", width: "65.45%", height: "2.315%" },
  { left: "17.27%", top: "71.76%", width: "65.45%", height: "2.315%" },
  { left: "48.48%", top: "27.08%", width: "3.03%", height: "45.83%" },
];

// The net's woven mesh — a horizontal and a vertical hairline grid over --muted.
const NET_MESH = [
  "repeating-linear-gradient(90deg,var(--muted-foreground) 0 1px,transparent 1px 5px)",
  "repeating-linear-gradient(0deg,var(--muted-foreground) 0 1px,transparent 1px 4px)",
].join(",");

/**
 * Anchors one card at `box` (a cell from `subCells`) inside a zoomed `CourtDiagram` —
 * a plain wrapper, sized and positioned by `box` directly. This used to need a
 * compensating `transform: scale()` (render the card at normal size, then shrink it
 * to fit) because the ancestor's own zoom was itself a transform: its layout size
 * never changed, so `box`'s real pixel size stayed at its tiny pre-zoom fraction
 * forever, and a card rendered directly at that size degenerated (uneven kerning, a
 * border-radius that ate the whole card). Now that the ancestor zoom is real layout
 * (see zoom-layer's own comment in `CourtDiagram`), `box` itself genuinely grows to
 * its full on-screen size once the zoom settles, so there's nothing left to undo.
 */
export function ZoomedCard({
  box,
  gapClassName,
  children,
}: {
  box: CourtBox;
  // Padding, in ordinary units (e.g. "p-[3px]") — the gap between adjacent cards. A
  // margin on the card itself would eat into the `h-full w-full` it's given, padding
  // here reads as the same visual gap without that fight.
  gapClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={box} className={cn("absolute", gapClassName)}>
      {children}
    </div>
  );
}

/**
 * The near/far player-name chips over a full-court `CourtDiagram` — final ball, serve
 * and return all draw the same two labels, opponent always on the far half and our
 * player always on the near one (see final-ball-screen.tsx's own comment on why that
 * convention never flips). Pass as `CourtDiagram`'s `children`.
 */
export function CourtPlayerLabels({
  trackedPlayerName,
  opponentName,
}: {
  trackedPlayerName: string;
  opponentName: string;
}) {
  return (
    <>
      {(["far", "near"] as const).map((side) => (
        <span
          key={side}
          className={cn(
            "pointer-events-none absolute left-1/2 z-30 flex h-5 -translate-x-1/2 items-center rounded-md bg-white/95 px-3 text-[11px] font-semibold tracking-[0.08em] text-chart-5 uppercase shadow-[0_1px_6px_rgb(0_0_0/0.2)]",
            side === "far" ? "top-[1.5%]" : "bottom-[1.5%]",
          )}
        >
          {side === "far" ? opponentName : trackedPlayerName}
        </span>
      ))}
    </>
  );
}

/**
 * `zones` are stacked in the order given, so a caller listing a wide gutter after the
 * service box it borders wins the overlap. `netLabel` chips the net band ("Net" while
 * the net is itself a tap target, "Rally length" where the band divides two choices);
 * `children` float over everything, for the cards the rally and shot screens lay on the
 * court.
 *
 * `zoomTo`, when given, scales and pans the whole diagram — lines, zones and children
 * alike — so that region fills the frame instead of the full court, animated via CSS
 * transition rather than replayed by hand (see zoom-layer's own comment below on why
 * that transition is real left/top/width/height rather than `transform: scale()`). A
 * screen that wants the animation to play on
 * its own arrival (rather than snapping straight to the zoomed frame on mount, which is
 * what a screen reached *after* the zoom has already happened wants) starts its own
 * local `zoomTo` state at `null` and flips it to the target region in an effect — see
 * rally-length-screen.tsx, the one screen in the flow that does this. A card laid over
 * a zoomed diagram should sit inside `ZoomedCard` above, or it renders at the tiny
 * pre-zoom size `subCells` gives it, text and border-radius included.
 */
export function CourtDiagram({
  zones,
  netLabel,
  zoomTo,
  className,
  children,
  onPendingChange,
}: {
  zones?: CourtTapZone[];
  netLabel?: string;
  zoomTo?: CourtRegion | null;
  className?: string;
  children?: React.ReactNode;
  // Fires while a zone tap's flash is pending, so a screen with its own buttons
  // alongside the court (Ace, Let, Fault) can disable them for the same window —
  // otherwise one of those fires immediately and the queued zone tap lands later
  // against whatever state has since moved on to.
  onPendingChange?: (pending: boolean) => void;
}) {
  const [flashing, setFlashing] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    };
  }, []);

  function tap(zone: CourtTapZone) {
    // A second tap during the flash would advance twice off one ball.
    if (flashTimer.current !== null) return;
    setFlashing(zone.name);
    onPendingChange?.(true);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlashing(null);
      onPendingChange?.(false);
      zone.onTap();
    }, FLASH_MS);
  }

  return (
    // Sized against both axes at once so the court keeps its real proportions: whichever
    // binds decides, the other is left as margin. Sizing off height alone cropped the
    // alleys, and the `min-width` guarding that then stretched the court instead.
    // `overflow-hidden` here (not just on the court layer below) is what crops a
    // zoomed-in court to this box rather than spilling past it.
    <div
      className={cn(
        "flex min-h-0 items-center justify-center overflow-hidden [container-type:size]",
        className,
      )}
    >
      {/* The surface color follows the match's court type, set as --court-surface on a
          screen root; --color-court is the hard/unspecified default. This frame's own
          size never changes — it's the stable reference the zoom pans and scales
          *inside of*, not the thing that moves (see zoom-layer just below). */}
      <div
        data-testid="court-surface"
        className="relative aspect-[165/216] w-[min(100cqw,calc(100cqh*165/216))] overflow-hidden rounded-md bg-[var(--court-surface,var(--color-court))]"
      >
        {/* The zoom itself: real left/top/width/height, not `transform: scale()`, so
            every frame of the transition is a genuine layout+paint at that frame's
            actual size — the court lines and any ZoomedCard content redraw crisp at
            every size the zoom passes through, rather than one small raster getting
            GPU-stretched across the whole animation (which is what read as blurry
            mid-zoom; `backface-visibility`/`will-change` tweaks to the old transform
            couldn't fix that, since stretching a cached raster is the mechanism, not
            a missing hint). The cost is real per-frame layout instead of a
            compositor-only transform — acceptable for a diagram this simple. */}
        <div
          data-testid="zoom-layer"
          className="absolute"
          style={{
            ...(zoomTo
              ? zoomBox(zoomTo)
              : { left: "0%", top: "0%", width: "100%", height: "100%" }),
            transitionProperty: "left, top, width, height",
            transitionDuration: `${String(ZOOM_MS)}ms`,
            transitionTimingFunction: ZOOM_EASE,
          }}
        >
          {COURT_LINES.map((line, index) => (
            <div key={index} className="absolute bg-white" style={line} />
          ))}

          {zones?.map((zone) => (
            <button
              key={zone.name}
              type="button"
              aria-label={zone.name}
              onClick={() => {
                tap(zone);
              }}
              style={zone.box}
              // transition-colors' defaults are already the handoff's --duration-fast
              // (150ms) and --ease-standard (cubic-bezier(0.4, 0, 0.2, 1)).
              className={cn(
                "absolute z-10 flex transition-colors",
                LABEL_PLACEMENTS[zone.labelPlacement ?? "center"],
                flashing === zone.name ? ZONE_TONES[zone.tone].flash : ZONE_TONES[zone.tone].idle,
              )}
            >
              {zone.label !== undefined && (
                <span
                  className={cn(
                    "text-[10px] font-medium tracking-[0.08em] text-white/95 uppercase [text-shadow:0_1px_2px_rgb(0_0_0/0.25)]",
                    LABEL_ORIENTATIONS[zone.labelOrientation ?? "horizontal"],
                  )}
                >
                  {zone.label}
                </span>
              )}
            </button>
          ))}

          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex h-[26px] -translate-y-1/2 items-center justify-center px-2">
            <span
              className="absolute inset-x-2 h-[22px] border-t-[3px] border-foreground bg-muted"
              style={{ backgroundImage: NET_MESH }}
            />
            {netLabel !== undefined && (
              <span className="relative z-10 rounded-sm bg-background px-[7px] py-0.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase shadow-[0_1px_3px_rgb(0_0_0/0.15)]">
                {netLabel}
              </span>
            )}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
