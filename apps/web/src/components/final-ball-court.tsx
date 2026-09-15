import type { CourtZoneCount } from "@matchpoint/api-client";

/**
 * "Final ball: where it landed" — four in-court cells (deuce/ad × short/deep),
 * majority-vs-not coloured rather than a continuous heat gradient: whichever
 * cell(s) hold the largest share, plus any other within 10 points of it, are
 * the "popular" zones worth a coach's attention, coloured by which side this
 * style is scoped to — green for a style scoped to points the tracked player
 * won, vermillion for one scoped to points they lost. Same "the one to
 * address" reasoning `fault-mode-court.tsx` already uses on the Serve tab,
 * and the same majority-margin/pattern mechanics, just fed by real counts
 * instead of pre-rounded shares.
 *
 * Net, long and wide are gone from this chart entirely — that out-of-bounds
 * breakdown now lives on the Serve tab's own fault-mode courts, so this
 * chart's zones (and the percentages they're a share of) are the four
 * in-court cells only. A thin net graphic still runs along the near edge,
 * purely decorative, so the diagram still reads as a court.
 */

const CELL_W = 90;
const CELL_H = 100;
const COURT_W = CELL_W * 2;
const COURT_H = CELL_H * 2;
const NET_H = 14;
const HEADER_H = 16;
const VIEW_W = COURT_W;
const VIEW_H = HEADER_H + COURT_H + NET_H;

const MAJORITY_MARGIN = 10;
// The court itself is always literally white regardless of app theme (like
// the surface-record card's own mask and the serve tab's fault-mode courts),
// so this mixes indigo's light-mode hex specifically rather than the theme
// token — mixing the already-lightened dark-mode indigo would wash out
// further against a background that never darkens with it.
const MINORITY_FILL = "color-mix(in oklch, #2E1A47 42%, white)";

const textHalo = {
  stroke: "var(--color-card)",
  strokeWidth: 3,
  strokeLinejoin: "round" as const,
  paintOrder: "stroke" as const,
};

/** The four zones this diagram draws, and therefore the whole of what its
 *  percentages are a share of — net/long/wide are deliberately excluded now,
 *  not just undrawn, so a point that faulted out doesn't quietly deflate
 *  every in-court percentage here. */
const DRAWN_ZONES = ["Ad short", "Deuce short", "Ad deep", "Deuce deep"] as const;

export function FinalBallCourt({
  zones,
  wonSide,
  flip = false,
}: {
  zones: CourtZoneCount[];
  /** Which majority colour this style is scoped to — green for a style
   *  scoped to points the tracked player won, vermillion for one scoped to
   *  points they lost. */
  wonSide: "you" | "opponents";
  /** Bottom-to-top becomes short then deep for a style scoped to points the
   *  tracked player won, where the ball that decided it left their own
   *  racquet — the near-to-far sense a coach standing behind them would see.
   *  The default (unflipped) orientation reads that way for the opponent's
   *  shot instead. Same convention this component used before this pass. */
  flip?: boolean;
}) {
  const byZone = new Map(zones.map((zone) => [zone.zone, zone.count]));
  const count = (zone: string) => byZone.get(zone) ?? 0;
  const drawn = DRAWN_ZONES.map(count);
  const total = drawn.reduce((sum, value) => sum + value, 0);
  const pct = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const max = Math.max(...drawn.map(pct));
  const isMajority = (value: number) => pct(value) >= max - MAJORITY_MARGIN;
  const majorityFill = wonSide === "you" ? "url(#final-ball-win)" : "url(#final-ball-loss)";

  // Column order matches the mockup's own: Ad on the left, Deuce on the right.
  const rowOrder: { label: string; ad: string; deuce: string }[] = [
    { label: "short", ad: "Ad short", deuce: "Deuce short" },
    { label: "deep", ad: "Ad deep", deuce: "Deuce deep" },
  ];
  const rows = flip ? [...rowOrder].reverse() : rowOrder;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={VIEW_W}
        height={VIEW_H}
        role="img"
        aria-label={`Final ball landing zones: ${DRAWN_ZONES.map(
          (zone) => `${zone} ${pct(count(zone))}%`,
        ).join(", ")}`}
      >
        <defs>
          {/* Win's own vertical-band pattern (web-color.md), so the majority
              fill still ships its required non-colour channel either way. */}
          <pattern id="final-ball-win" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="var(--color-outcome-win)" />
            <rect width="4" height="8" fill="white" fillOpacity="0.4" />
          </pattern>
          {/* Vermillion's own 45°-diagonal-band pattern, same tile as
              `fault-mode-court.tsx`'s own majority fill. */}
          <pattern
            id="final-ball-loss"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="10" height="10" fill="var(--color-outcome-unforced)" />
            <rect width="5" height="10" fill="black" fillOpacity="0.5" />
          </pattern>
          <pattern id="final-ball-net" width="7" height="7" patternUnits="userSpaceOnUse">
            <path
              d="M0 0 L7 7 M7 0 L0 7"
              stroke="var(--color-card-foreground)"
              strokeWidth="0.7"
              opacity="0.6"
            />
          </pattern>
        </defs>

        <text
          x={COURT_W / 4}
          y={HEADER_H - 4}
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill="var(--color-foreground)"
          {...textHalo}
        >
          AD
        </text>
        <text
          x={(COURT_W * 3) / 4}
          y={HEADER_H - 4}
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill="var(--color-foreground)"
          {...textHalo}
        >
          DEUCE
        </text>

        {rows.map((row, rowIndex) => {
          const y1 = HEADER_H + rowIndex * CELL_H;
          const y2 = y1 + CELL_H;
          return (
            <g key={row.label}>
              {(["ad", "deuce"] as const).map((side) => {
                const x1 = side === "ad" ? 0 : CELL_W;
                const x2 = x1 + CELL_W;
                const value = count(row[side]);
                const majority = isMajority(value);
                const fill = majority ? majorityFill : MINORITY_FILL;
                const textColor = majority ? "white" : "var(--color-foreground)";
                return (
                  <g key={side}>
                    <rect
                      x={x1}
                      y={y1}
                      width={x2 - x1}
                      height={y2 - y1}
                      fill={fill}
                      stroke="var(--color-card)"
                      strokeWidth={1.5}
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2}
                      fontSize="16"
                      fontWeight="700"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={textColor}
                      {...(majority ? {} : textHalo)}
                    >
                      {pct(value)}%
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        <rect
          x={0}
          y={HEADER_H}
          width={COURT_W}
          height={COURT_H}
          fill="none"
          stroke="var(--color-foreground)"
          strokeWidth={2}
        />
        <line
          x1={COURT_W / 2}
          y1={HEADER_H}
          x2={COURT_W / 2}
          y2={HEADER_H + COURT_H}
          stroke="var(--color-card)"
          strokeWidth={1}
        />
        <line
          x1={0}
          y1={HEADER_H + CELL_H}
          x2={COURT_W}
          y2={HEADER_H + CELL_H}
          stroke="var(--color-card)"
          strokeWidth={1}
        />

        {/* Purely decorative net graphic along the near edge — not a scored
            zone (no count, no label), just enough that the diagram still
            reads as a court now that the out-zones are gone. */}
        <rect
          x={0}
          y={HEADER_H + COURT_H}
          width={COURT_W}
          height={NET_H}
          fill="url(#final-ball-net)"
        />
        <rect
          x={-3}
          y={HEADER_H + COURT_H - 3}
          width={5}
          height={NET_H + 6}
          fill="var(--color-foreground)"
        />
        <rect
          x={COURT_W - 2}
          y={HEADER_H + COURT_H - 3}
          width={5}
          height={NET_H + 6}
          fill="var(--color-foreground)"
        />
      </svg>
    </div>
  );
}
