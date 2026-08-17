// Anchors reused from .claude/rules/web-color.md's categorical palette (Burnt vermillion,
// Orange, Jade green) rather than inventing new hexes — see the "Sequential / severity
// scale" section there for why these three colors are allowed to serve a second role.
const SEVERITY_SCALE_ANCHORS: [number, number, number][] = [
  [0x9c, 0x3d, 0x0a], // weakest
  [0xe6, 0x9f, 0x00], // mid
  [0x1f, 0xbf, 0x8c], // strongest
];

function toHex(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, "0");
}

/**
 * Linearly interpolates a fill color across a two-segment red→orange→green ramp, for an
 * ordinal/severity scale (e.g. password strength) rather than a set of unordered
 * categories — the categorical rainbow palette doesn't apply here, since this is one
 * continuum, not distinct categories. `t` is the position on the scale, 0 (weakest) to 1
 * (strongest).
 */
export function interpolateSeverityColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const segment = clamped < 0.5 ? 0 : 1;
  const segmentT = clamped < 0.5 ? clamped / 0.5 : (clamped - 0.5) / 0.5;
  const [r1, g1, b1] = SEVERITY_SCALE_ANCHORS[segment]!;
  const [r2, g2, b2] = SEVERITY_SCALE_ANCHORS[segment + 1]!;
  const r = r1 + (r2 - r1) * segmentT;
  const g = g1 + (g2 - g1) * segmentT;
  const b = b1 + (b2 - b1) * segmentT;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
