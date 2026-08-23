---
paths:
  - apps/web/**
---

# Color rule

This is an always-on constraint, not a workflow to invoke. Apply it to every screen, component, or
chart without being asked. Never use a color from this file for anything other than its assigned
role. For the reasoning behind these specific choices, see
[docs/color-palette.md](../../docs/color-palette.md).

## Navigation / brand color

**Deep blue `#045C8C`** — reserved for navigation bars, active tabs, links, and primary buttons.
This is the only color allowed to represent brand/chrome and interactive state. It must never be
reused for a category, status, or data color — if blue starts meaning "primary button" in one place
and "category 5" in another, it stops being scannable at a glance.

**Dark-mode variant: `#1E88C7`.** Blue has fewer cone receptors dedicated to it than red or green,
so it reads as perceptually darker than its luminance number alone suggests — especially against a
near-black background, where `#045C8C` loses too much contrast. Use `#1E88C7` for all nav/brand
elements whenever dark mode is active; use `#045C8C` in light mode. Same semantic role, two tokens —
do not try to make one hex serve both themes.

## Categorical / rainbow palette

Colorblind-safe (protanopia/deuteranopia) rainbow sequence. Use this set whenever multiple
categories, series, or values need distinct colors — charts, tags, legends, status chips.

| Position | Name             | Hex       | Pattern                                                                                                                |
| -------- | ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Red      | Burnt vermillion | `#9C3D0A` | Coarse diagonal bands (45°) — **outcome-exclusive, see Dashboard color roles below**                                   |
| Orange   | Orange           | `#E69F00` | Large sparse dots — **outcome-exclusive, see Dashboard color roles below**                                             |
| Yellow   | Pale yellow      | `#EDDD6E` | Coarse cross-hatch                                                                                                     |
| Green    | Jade green       | `#1FBF8C` | Medium vertical bands — **outcome-exclusive, see Dashboard color roles below**                                         |
| Blue     | Deep blue        | `#045C8C` | Fine diagonal bands (-45°) — **also the nav color; do not use as a category color if nav is visible in the same view** |
| Indigo   | Dark indigo      | `#2E1A47` | Small dense dots                                                                                                       |
| Violet   | Rose violet      | `#D9569E` | Fine cross-hatch                                                                                                       |

> Deep blue does double duty as both the nav color and a rainbow swatch. If a screen shows both
> navigation chrome and this palette as data colors (e.g. a chart with a visible nav bar), skip blue
> as a category color on that screen to avoid the same ambiguity this file exists to prevent.

> Red, Orange, and Green are restricted further still: on the dashboard, they're reserved
> exclusively for point outcomes and hero-metric score bands, never a general-purpose category color
> the way Yellow, Indigo, and Violet are. See **Dashboard color roles** below for exactly which
> chart gets which colors.

### Pattern rule

Color alone never guarantees separation for every severity of color vision deficiency. Every
categorical color must ship with its pattern — never color alone.

- **Red — bold coarse diagonal bands, 45°**: 10×10px tile, rotated 45°, solid 5×10px band (half the
  tile), black at 50% opacity. Base color `#9C3D0A`.
- **Orange — bold large, sparse dots**: 14×14px tile, circle radius 3px centered, black at 45%
  opacity.
- **Yellow — bold coarse cross-hatch**: 12×12px tile, X of two diagonal lines corner-to-corner,
  stroke width 2.5px, black at 45% opacity.
- **Green — bold medium vertical bands**: 8×8px tile, solid 4×8px vertical band (half the tile),
  white at 40% opacity. Base color `#1FBF8C`.
- **Blue — bold fine diagonal bands, -45°**: 6×6px tile, rotated -45°, solid 3×6px band (half the
  tile), white at 40% opacity. Same band geometry family as red, but narrower and finer —
  intentional: red and blue share a band motif but differ in both rotation _and_ density, so they're
  distinguishable even under total hue loss.
- **Indigo — bold small, dense dots**: 8×8px tile, circle radius 1.5px, white at 50% opacity. Same
  dot motif as orange; separated by opposite mark color, a large lightness gap, and smaller/denser
  dots vs. orange's larger/sparser ones.
- **Violet — bold fine cross-hatch**: 6×6px tile, same X geometry as yellow, stroke width 1.5px,
  black at 40% opacity. Separated from yellow by opposite mark color, a large lightness/saturation
  gap, and finer, denser hatching vs. yellow's coarser one. Base color `#D9569E`.

Rules for any new or modified pattern:

- Marks must be legible as a shape on their own — never a faint texture.
- Choose black or white per-swatch based on genuine contrast against that swatch's own base color.
- If two colors must reuse a motif, separate them by rotation/direction, mark color, or a large
  lightness gap — never let two adjacent colors share a motif _and_ similar lightness.
- Within a shared motif family, also vary tile scale/density — never let two colors sharing a motif
  also share the same tile scale. Density is an independent channel from hue, lightness, and motif
  shape.

## Sequential / severity scale

Use this for one ordinal quantity that runs from worse to better (e.g. password strength) — never
for a set of unordered categories, which is what the rainbow palette above is for.

Interpolate linearly across three anchors, reused from the categorical palette rather than invented
fresh: **Burnt vermillion `#9C3D0A`** (weakest) → **Orange `#E69F00`** (mid) → **Jade green
`#1FBF8C`** (strongest). Two segments — vermillion→orange for the lower half of the scale,
orange→green for the upper half — so the fill is a smooth continuum, not discrete hard-edged bands.
A severity scale's whole point is the continuum; chopping it into swatches would make it read as
categories again.

These three hexes now carry a second, documented role alongside their categorical one — same
principle as blue's dual nav/categorical role above: each hex is valid in whichever context applies,
categorical swatch or severity anchor, never both meanings on the same screen at once.

A sequential fill has no room for a pattern overlay (it's a thin continuous bar, not a discrete
swatch), so it can't lean on the categorical palette's pattern-redundancy rule. Pair it with a text
label instead (e.g. "Weak" / "Strong") as the non-color channel — same purpose as a pattern, a
different mechanism to fit a different shape of UI.

## Dashboard color roles

How the palettes above are actually assigned across MatchPoint's analytics dashboard — each chart
type gets exactly one treatment below, not a free choice per screen.

**Point outcomes — exclusive.** Jade green `#1FBF8C` (win), Burnt vermillion `#9C3D0A` (unforced
error), Orange `#E69F00` (forced error). Reserved exclusively for point outcomes and WHOOP-style
hero-metric score bands (good/neutral/bad) — the password strength meter's sequential scale above is
already exactly this pattern (weak → strong as a bad → good score band), not a fourth, unrelated
reuse of these hexes. Never use these three colors for anything else, including as a general
categorical swatch — that's what Yellow, Indigo, and Violet are for.

**Navigation / brand** — unchanged from above: `#045C8C` light / `#1E88C7` dark, never reused for
outcome or category meaning, on any screen.

**The safe non-outcome set** — Pale yellow `#EDDD6E`, Dark indigo `#2E1A47`, Rose violet `#D9569E`,
plus Deep blue when nav chrome isn't visible on that particular screen. Reach for this set for any
categorical distinction on the dashboard that isn't a point outcome.

### Per-chart assignment

- **Shot-type radar** — single color per series, not per axis. The four stored shot types (drive,
  volley, drop shot, lob: #175's final list) are axis labels only, never separate colors.
  - Single player view: one neutral/nav color.
  - H2H overlay (player vs. opponent): two colors, one per player, from the safe non-outcome set
    (e.g. blue vs. violet).
- **Trends — distribution histogram / scatter + trend line** — single-series charts. Nav blue or
  neutral. No categorical color needed.
- **Trends — journal correlation panel** (binary tag comparison) — 2 colors from the safe
  non-outcome set (e.g. yellow vs. violet).
- **H2H — slope graph** (hold %, BP-conversion %, forced:unforced — 3 lines) — 3 colors from the
  safe non-outcome set (e.g. yellow, indigo, violet). Avoid blue here specifically — nav chrome is
  visible on this screen.
- **H2H — segmented control** (aggregate vs. per-match) — active state uses nav blue, inactive uses
  neutral gray. No categorical color needed.
- **Squad stats — Spread histogram / Trend line** — not single-series in the sense the row above
  means: both are one chart switched between three different metrics (Record / Forced:Unforced / 1st
  serve %) via a dropdown, not one fixed measurement. Each metric gets its own color from the safe
  non-outcome set (yellow / indigo / violet), shared between the two charts so a metric is always
  the same color everywhere it appears on that page. Avoid blue — the bottom nav is visible on this
  page. The histogram's bars carry the metric's real pattern fill (an SVG `<pattern>`, not the CSS
  `pattern-*` utilities, which only paint HTML boxes); the trend line's stroke can't show a hatch
  texture at 2px, so it carries a per-metric dash style instead (solid / dashed / dotted) as the
  same principle's line-shaped equivalent.

## Light/dark mode background rule

Every swatch or symbol must carry a **dual-ring halo**: a 1px white inner ring plus a 1px black
outer ring (2px total), applied together, always. This replaces a single fixed border — a single
tone only works against backgrounds on one side of the contrast spectrum, and picking the right tone
per-theme requires conditional logic. A dual-ring halo needs no conditional logic: one of the two
rings will always contrast against whatever's behind it, light mode or dark mode, white page or
black page.

Apply this to every categorical swatch and every pattern mark. Check every new or edited color
against both a light and a dark background before it ships — this applies to every future addition
to this file, not just the colors that look risky at first glance.
