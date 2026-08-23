import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";

import type { CourtZoneCount } from "@/lib/analytics/types.provisional";

/**
 * A real tennis-court diagram for "final ball: where it landed": four in-court
 * cells (deuce/ad × short/deep) plus the three out-zones (net/long/wide)
 * around the border, shaded by relative frequency in a single hue.
 *
 * A frequency map, not a category: per `.claude/rules/web-color.md`'s chart-color
 * rule, that's `--chart-1` at varying intensity (the token this project's own
 * defaults reserve for non-categorical chart data), never the nav-reserved
 * `--color-primary` blue and never one of the seven categorical/outcome colors.
 *
 * Net, long and wide each also get a real visual cue on top of that color, not
 * just a text label: a mesh texture and posts for the net, and arrows pointing
 * off the court for long/wide, in the same wide-fault direction language
 * `breakdown-bars.tsx` already uses elsewhere on this screen (`ArrowLeftRight`
 * for wide, `ArrowUp` for long) — so a coach reads the diagram as a court at a
 * glance, without translating a legend first.
 *
 * Every icon and every piece of text carries a same-tone halo (`paintOrder`
 * stroke) so it stays legible against whatever heat-intensity color sits behind
 * it, from barely-tinted to fully saturated — a fixed text color alone would
 * lose contrast at one end of that range or the other.
 */

// Named layout constants rather than scattered magic numbers, since every
// piece below has to agree on where the out-zone bars, headers and court
// actually sit.
const WIDE_W = 24;
const HEADER_H = 16;
const OUT_H = 22;
const COURT_W = 180;
const COURT_H = 200;
const COURT_X0 = WIDE_W;
const COURT_X1 = WIDE_W + COURT_W;
const COURT_MID_X = WIDE_W + COURT_W / 2;
const COURT_Y0 = HEADER_H + OUT_H;
const COURT_Y1 = COURT_Y0 + COURT_H;
const VIEW_W = WIDE_W * 2 + COURT_W;
const VIEW_H = COURT_Y1 + OUT_H;

const textHalo = {
  stroke: "var(--color-card)",
  strokeWidth: 3,
  strokeLinejoin: "round" as const,
  paintOrder: "stroke" as const,
};

export function CourtHeatmap({
  zones,
  flip = false,
}: {
  zones: CourtZoneCount[];
  /**
   * Bottom-to-top becomes net, short, deep, long: for a style scoped to
   * points the tracked player won, where the ball that decided it left their own
   * racquet: net (right in front of them) reads as "near", long (the far
   * baseline) as "far", the same near-to-far sense a coach standing behind them
   * would see. The default (unflipped) orientation reads that way for the
   * opponent's shot instead, which is what a style scoped to points they won
   * describes.
   */
  flip?: boolean;
}) {
  const byZone = new Map(zones.map((zone) => [zone.zone, zone.count]));
  const count = (zone: string) => byZone.get(zone) ?? 0;
  const max = Math.max(1, ...zones.map((zone) => zone.count));
  const total = zones.reduce((sum, zone) => sum + zone.count, 0) || 1;

  const intensity = (value: number) => 0.14 + (value / max) * 0.72;
  const pct = (value: number) => Math.round((value / total) * 100);
  const fill = (value: number) =>
    `color-mix(in oklch, var(--color-chart-1) ${intensity(value) * 100}%, var(--color-card))`;

  // Column order matches the mockup's own: Ad on the left, Deuce on the right.
  const rowOrder: { label: string; ad: string; deuce: string }[] = [
    { label: "short", ad: "Ad short", deuce: "Deuce short" },
    { label: "deep", ad: "Ad deep", deuce: "Deuce deep" },
  ];
  const rows = flip ? [...rowOrder].reverse() : rowOrder;

  const net = count("Net");
  const long = count("Long");
  const wide = count("Wide");
  const topZone = flip
    ? { text: "LONG", value: long, kind: "long" as const }
    : { text: "NET", value: net, kind: "net" as const };
  const bottomZone = flip
    ? { text: "NET", value: net, kind: "net" as const }
    : { text: "LONG", value: long, kind: "long" as const };

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width={VIEW_W + 40}
        height={VIEW_H + 40}
        role="img"
        aria-label="Final ball landing zones"
      >
        <defs>
          {/* A real net texture, not just a color, so the top/bottom bar reads as
              "the net" on its own without the text label doing all the work. */}
          <pattern id="court-heatmap-net" width="7" height="7" patternUnits="userSpaceOnUse">
            <path
              d="M0 0 L7 7 M7 0 L0 7"
              stroke="var(--color-card-foreground)"
              strokeWidth="0.7"
              opacity="0.6"
            />
          </pattern>
        </defs>

        <text
          x={COURT_X0 + COURT_W / 4}
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
          x={COURT_X0 + (COURT_W * 3) / 4}
          y={HEADER_H - 4}
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill="var(--color-foreground)"
          {...textHalo}
        >
          DEUCE
        </text>

        <OutZoneBar
          y={HEADER_H}
          zone={topZone}
          fill={fill(topZone.value)}
          pct={pct}
          position="top"
        />
        <OutZoneBar
          y={COURT_Y1}
          zone={bottomZone}
          fill={fill(bottomZone.value)}
          pct={pct}
          position="bottom"
        />

        <WideBar x={0} side="left" value={wide} fill={fill(wide)} pct={pct} showLabel={false} />
        <WideBar x={COURT_X1} side="right" value={wide} fill={fill(wide)} pct={pct} showLabel />

        {rows.map((row, rowIndex) => {
          const y1 = COURT_Y0 + rowIndex * (COURT_H / 2);
          const y2 = y1 + COURT_H / 2;
          return (
            <g key={row.label}>
              {(["ad", "deuce"] as const).map((side) => {
                const x1 = side === "ad" ? COURT_X0 : COURT_MID_X;
                const x2 = side === "ad" ? COURT_MID_X : COURT_X1;
                const value = count(row[side]);
                return (
                  <g key={side}>
                    <rect
                      x={x1}
                      y={y1}
                      width={x2 - x1}
                      height={y2 - y1}
                      fill={fill(value)}
                      stroke="var(--color-card)"
                      strokeWidth={1.5}
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2}
                      fontSize="15"
                      fontWeight="700"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="var(--color-foreground)"
                      {...textHalo}
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
          x={COURT_X0}
          y={COURT_Y0}
          width={COURT_W}
          height={COURT_H}
          fill="none"
          stroke="var(--color-foreground)"
          strokeWidth={2}
        />
        <line
          x1={COURT_MID_X}
          y1={COURT_Y0}
          x2={COURT_MID_X}
          y2={COURT_Y1}
          stroke="var(--color-card)"
          strokeWidth={1}
        />
        <line
          x1={COURT_X0}
          y1={COURT_Y0 + COURT_H / 2}
          x2={COURT_X1}
          y2={COURT_Y0 + COURT_H / 2}
          stroke="var(--color-card)"
          strokeWidth={1}
        />
      </svg>

      <div className="flex items-center justify-center gap-2">
        <span className="text-[0.6875rem] font-medium text-foreground">Least common</span>
        <div
          className="h-2.5 w-28 rounded-sm border"
          style={{
            background: "linear-gradient(to right, var(--color-card), var(--color-chart-1))",
          }}
        />
        <span className="text-[0.6875rem] font-medium text-foreground">Most common</span>
      </div>
      <p className="text-center text-[0.6875rem] leading-relaxed text-muted-foreground">
        Color shows how often the ball ends up there, not good vs. bad: a hot zone just means a
        common outcome for this style.
      </p>
    </div>
  );
}

/** The net or the long line, spanning the court's own width. Icon and label
 *  are both large and carry the halo, since this bar's own fill runs the same
 *  color range as the cells it borders and can't be assumed light or dark. */
function OutZoneBar({
  y,
  zone,
  fill,
  pct,
  position,
}: {
  y: number;
  zone: { text: string; value: number; kind: "net" | "long" };
  fill: string;
  pct: (value: number) => number;
  /** Which edge of the court this bar sits on — the long-zone arrow has to
   *  point off the court on that edge, so top points up and bottom points
   *  down, whichever one the flip prop put "Long" on. */
  position: "top" | "bottom";
}) {
  const isNet = zone.kind === "net";
  const LongArrow = position === "top" ? ArrowUp : ArrowDown;
  const iconSize = 20;

  return (
    <g>
      <rect x={COURT_X0} y={y} width={COURT_W} height={OUT_H} fill={fill} />
      {isNet ? (
        <>
          <rect x={COURT_X0} y={y} width={COURT_W} height={OUT_H} fill="url(#court-heatmap-net)" />
          {/* Net posts: two solid marks either post would stand at, so the bar
              reads as "the net strung between two posts" rather than a plain
              stripe. */}
          <rect
            x={COURT_X0 - 3}
            y={y - 3}
            width={5}
            height={OUT_H + 6}
            fill="var(--color-foreground)"
          />
          <rect
            x={COURT_X1 - 2}
            y={y - 3}
            width={5}
            height={OUT_H + 6}
            fill="var(--color-foreground)"
          />
        </>
      ) : (
        <g>
          <circle
            cx={COURT_X0 + 10 + iconSize / 2}
            cy={y + OUT_H / 2}
            r={iconSize / 2 + 3}
            fill="var(--color-card)"
            stroke="var(--color-foreground)"
            strokeWidth={1}
          />
          <LongArrow
            x={COURT_X0 + 10}
            y={y + OUT_H / 2 - iconSize / 2}
            width={iconSize}
            height={iconSize}
            stroke="var(--color-foreground)"
            strokeWidth={2.5}
          />
        </g>
      )}
      <text
        x={COURT_MID_X}
        y={y + OUT_H / 2}
        fontSize="12"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--color-foreground)"
        {...textHalo}
      >
        {zone.text} {pct(zone.value)}%
      </text>
    </g>
  );
}

/** A wide sideline strip, its own icon pointing off the court. There's one
 *  `Wide` count in the data, not a left and a right, so only one of the two
 *  strips carries the percentage label — both got it once, which made the
 *  diagram's percentages add up past 100 (the same fault counted twice). */
function WideBar({
  x,
  side,
  value,
  fill,
  pct,
  showLabel,
}: {
  x: number;
  side: "left" | "right";
  value: number;
  fill: string;
  pct: (value: number) => number;
  showLabel: boolean;
}) {
  const Icon = side === "left" ? ArrowLeft : ArrowRight;
  const iconSize = 18;
  const midY = COURT_Y0 + COURT_H / 2;
  const labelX = x + WIDE_W / 2;

  return (
    <g>
      <rect x={x} y={COURT_Y0} width={WIDE_W} height={COURT_H} fill={fill} />
      <circle
        cx={x + WIDE_W / 2}
        cy={midY - 46 + iconSize / 2}
        r={iconSize / 2 + 3}
        fill="var(--color-card)"
        stroke="var(--color-foreground)"
        strokeWidth={1}
      />
      <Icon
        x={x + WIDE_W / 2 - iconSize / 2}
        y={midY - 46}
        width={iconSize}
        height={iconSize}
        stroke="var(--color-foreground)"
        strokeWidth={2.5}
      />
      {showLabel && (
        <text
          x={labelX}
          y={midY + 30}
          fontSize="11"
          fontWeight="700"
          textAnchor="middle"
          fill="var(--color-foreground)"
          transform={`rotate(${side === "left" ? -90 : 90} ${labelX} ${midY + 30})`}
          {...textHalo}
        >
          WIDE {pct(value)}%
        </text>
      )}
    </g>
  );
}
