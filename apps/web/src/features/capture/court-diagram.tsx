/**
 * The court five of the capture screens tap on — serve, return, rally, final shot and
 * final ball differ only in which zones sit over the same diagram, so the diagram is
 * built once and parameterised by them rather than redrawn per screen.
 *
 * Line and zone percentages are copied verbatim from the capture flow design
 * handoff, which scaled them off a real doubles court.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// A zone flashes before the flow advances, so the coach sees which zone registered
// without looking up from the match. Local only — a timer, never a promise, per
// .claude/rules/web-capture.md.
const FLASH_MS = 420;

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
 * `zones` are stacked in the order given, so a caller listing a wide gutter after the
 * service box it borders wins the overlap. `netLabel` chips the net band ("Net" while
 * the net is itself a tap target, "Rally length" where the band divides two choices);
 * `children` float over everything, for the cards the rally and shot screens lay on the
 * court.
 */
export function CourtDiagram({
  zones,
  netLabel,
  className,
  children,
  onPendingChange,
}: {
  zones?: CourtTapZone[];
  netLabel?: string;
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
    // The surface color follows the match's court type, set as --court-surface on a
    // screen root; --color-court is the hard/unspecified default.
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-md bg-[var(--court-surface,var(--color-court))]",
        className,
      )}
    >
      <div className="absolute top-1/2 left-1/2 h-full min-w-full -translate-x-1/2 -translate-y-1/2 aspect-[165/216]">
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
  );
}
