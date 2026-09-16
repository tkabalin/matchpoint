import type { FaultModeShares } from "@matchpoint/api-client";
import { ArrowLeft, ArrowRight, ArrowUp, Grid2x2 } from "lucide-react";

/**
 * Where a serve's faults actually land, as a real court rather than three bars:
 * one big white court (no in-court split — a fault mode has no landing depth
 * or side the way a rally's final ball does) bordered by the net, long and
 * wide out-zones, each sized by nothing but labelled with its own share.
 *
 * `FaultModeShares`' three percentages are each rounded independently
 * server-side and so don't reliably sum to 100 — renormalised here purely to
 * decide which is the majority, since what's actually printed on each zone
 * is its own raw count (`net_count`/`long_count`/`wide_count`, #295) rather
 * than a percentage a coach would have to weigh against an unknown sample
 * size ("42%" could be 42 of 100 serves or 3 of 7).
 *
 * Colour is majority-vs-not: whichever fault mode has the largest share, plus
 * any other within 10 points of it, is the one to address, so it carries
 * vermillion (this tab's own fault colour, with its usual diagonal-band
 * pattern). Everything else is a light, unpatterned indigo — a de-emphasised
 * "not the one to look at" rather than a second competing category, which is
 * also why it needs no pattern of its own the way a true categorical swatch
 * would. `final-ball-court.tsx`'s own majority fill (Rally tab) uses this
 * same mechanic, just fed by real counts throughout and win/loss-themed
 * colour.
 */

// Equal to OUT_H (long/net's own thickness), not a separately-tuned number:
// the wide zone reads as a third, equally-weighted out-zone framing the
// court rather than a visibly thinner afterthought beside the other two.
const WIDE_W = 22;
const OUT_H = 22;
const COURT_W = 96;
const COURT_H = 116;
const COURT_X0 = WIDE_W;
const COURT_X1 = WIDE_W + COURT_W;
const COURT_MID_X = WIDE_W + COURT_W / 2;
const VIEW_W = WIDE_W * 2 + COURT_W;
const VIEW_H = OUT_H * 2 + COURT_H;

const MAJORITY_FILL = "url(#fault-court-majority)";
// The court itself is always literally white regardless of app theme (like
// the surface-record card's own mask), so this mixes indigo's light-mode hex
// specifically rather than the theme token — mixing the already-lightened
// dark-mode indigo would wash out further against a background that never
// darkens with it.
const MINORITY_FILL = "color-mix(in oklch, #2E1A47 42%, white)";
const MAJORITY_MARGIN = 10;

const textHalo = {
  stroke: "var(--color-card)",
  strokeWidth: 3,
  strokeLinejoin: "round" as const,
  paintOrder: "stroke" as const,
};

/** Percentages renormalised so the three always sum to 100, purely to decide
 *  which of them count as "majority" (the largest, plus any other within 10
 *  points of it) — the colour signal, never what's printed on the zone. */
function faultShares(shares: FaultModeShares) {
  const total = shares.net + shares.long + shares.wide;
  const pct = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const net = pct(shares.net);
  const long = pct(shares.long);
  const wide = pct(shares.wide);
  const max = Math.max(net, long, wide);
  const isMajority = (value: number) => value >= max - MAJORITY_MARGIN;
  return { isMajority };
}

export function FaultModeCourt({ shares }: { shares: FaultModeShares }) {
  const { isMajority } = faultShares(shares);
  // Long at the top, net at the bottom, matching the app's reference court
  // orientation (`final-ball-court.tsx`) — LONG points away off the far edge,
  // NET sits right in front.
  const topZone = {
    text: "LONG",
    pct: shares.long,
    count: shares.long_count,
    kind: "long" as const,
  };
  const bottomZone = {
    text: "NET",
    pct: shares.net,
    count: shares.net_count,
    kind: "net" as const,
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={VIEW_W}
      height={VIEW_H}
      role="img"
      aria-label={`Fault mode: net ${shares.net_count}, long ${shares.long_count}, wide ${shares.wide_count}`}
    >
      <defs>
        {/* Vermillion's own 45°-diagonal-band pattern (web-color.md), so the
            majority fill still ships its required non-colour channel. */}
        <pattern
          id="fault-court-majority"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="10" height="10" fill="var(--color-outcome-unforced)" />
          <rect width="5" height="10" fill="black" fillOpacity="0.5" />
        </pattern>
        <pattern id="fault-court-net" width="6" height="6" patternUnits="userSpaceOnUse">
          <path
            d="M0 0 L6 6 M6 0 L0 6"
            stroke="var(--color-card-foreground)"
            strokeWidth="0.6"
            opacity="0.6"
          />
        </pattern>
      </defs>

      <OutZoneBar y={0} zone={topZone} isMajority={isMajority} />
      <OutZoneBar y={OUT_H + COURT_H} zone={bottomZone} isMajority={isMajority} />
      <WideBar
        x={0}
        side="left"
        count={shares.wide_count}
        majority={isMajority(shares.wide)}
        showLabel={false}
      />
      <WideBar
        x={COURT_X1}
        side="right"
        count={shares.wide_count}
        majority={isMajority(shares.wide)}
        showLabel
      />

      {/* The court itself: one plain white square, no in-court split. */}
      <rect
        x={COURT_X0}
        y={OUT_H}
        width={COURT_W}
        height={COURT_H}
        fill="white"
        stroke="var(--color-foreground)"
        strokeWidth={2}
      />
    </svg>
  );
}

function OutZoneBar({
  y,
  zone,
  isMajority,
}: {
  y: number;
  zone: { text: string; pct: number; count: number; kind: "net" | "long" };
  isMajority: (value: number) => boolean;
}) {
  const fill = isMajority(zone.pct) ? MAJORITY_FILL : MINORITY_FILL;
  const textColor = isMajority(zone.pct) ? "white" : "var(--color-foreground)";
  const isNet = zone.kind === "net";
  const iconSize = 14;

  return (
    <g>
      <rect x={COURT_X0} y={y} width={COURT_W} height={OUT_H} fill={fill} />
      {isNet ? (
        <>
          <rect x={COURT_X0} y={y} width={COURT_W} height={OUT_H} fill="url(#fault-court-net)" />
          <Grid2x2
            x={COURT_X0 + 6}
            y={y + OUT_H / 2 - iconSize / 2}
            width={iconSize}
            height={iconSize}
            stroke={textColor}
            strokeWidth={2}
          />
        </>
      ) : (
        <ArrowUp
          x={COURT_X0 + 6}
          y={y + OUT_H / 2 - iconSize / 2}
          width={iconSize}
          height={iconSize}
          stroke={textColor}
          strokeWidth={2.5}
        />
      )}
      <text
        x={COURT_MID_X + 8}
        y={y + OUT_H / 2}
        fontSize="10"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textColor}
        {...(isMajority(zone.pct) ? {} : textHalo)}
      >
        {zone.text} {zone.count}
      </text>
    </g>
  );
}

function WideBar({
  x,
  side,
  count,
  majority,
  showLabel,
}: {
  x: number;
  side: "left" | "right";
  count: number;
  majority: boolean;
  showLabel: boolean;
}) {
  const Icon = side === "left" ? ArrowLeft : ArrowRight;
  // Matches OutZoneBar's own icon/text sizing now that the band is the same
  // thickness as long/net's, rather than the smaller pair tuned for the old,
  // narrower strip.
  const iconSize = 14;
  const midY = OUT_H + COURT_H / 2;
  const labelX = x + WIDE_W / 2;
  const fill = majority ? MAJORITY_FILL : MINORITY_FILL;
  const textColor = majority ? "white" : "var(--color-foreground)";

  return (
    <g>
      <rect x={x} y={OUT_H} width={WIDE_W} height={COURT_H} fill={fill} />
      <Icon
        x={x + WIDE_W / 2 - iconSize / 2}
        y={midY - iconSize / 2}
        width={iconSize}
        height={iconSize}
        stroke={textColor}
        strokeWidth={2.5}
      />
      {showLabel && (
        <text
          x={labelX}
          y={midY + 30}
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill={textColor}
          transform={`rotate(${side === "left" ? -90 : 90} ${labelX} ${midY + 30})`}
          {...(majority ? {} : textHalo)}
        >
          WIDE {count}
        </text>
      )}
    </g>
  );
}
