/**
 * `ChartContainer` styles every tick's `<text>` to `fill-muted-foreground` via
 * a stylesheet rule, which beats a plain `fill` attribute passed through
 * `tick={{...}}` (a presentation attribute loses to any same-property CSS
 * rule, however low its specificity). A custom tick using `style` — a real
 * inline style, which does win — is the only way to make an axis read darker
 * and larger than the app's other, lower-stakes charts.
 */

interface ChartTickProps {
  x?: number;
  y?: number;
  payload?: { value: string | number };
}

export function LegibleXTick({ x, y, payload }: ChartTickProps) {
  return (
    <text
      x={x}
      y={y}
      dy={12}
      textAnchor="middle"
      style={{ fill: "var(--color-foreground)", fontSize: 11, fontWeight: 700 }}
    >
      {payload?.value}
    </text>
  );
}

export function LegibleYTick({ x, y, payload }: ChartTickProps) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      style={{ fill: "var(--color-foreground)", fontSize: 11, fontWeight: 700 }}
    >
      {payload?.value}
    </text>
  );
}
