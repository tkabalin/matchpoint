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

**Indigo's dark-mode variant: `#9B7FC4`.** `#2E1A47` measures 1.27:1 against the app's dark-mode
background — a real WCAG failure (a graphical object needs at least 3:1), not just a dim shade.
`#9B7FC4` measures 5.85:1 there, lighter while staying clearly indigo/purple rather than drifting
toward violet's rose/pink. Same semantic role, two tokens, same reasoning as nav blue above — use
`#9B7FC4` for indigo whenever dark mode is active, `#2E1A47` in light mode. Violet needs no
dark-mode variant either: `#D9569E` measures 5.42:1 against the same dark background, already
comfortably clear.

**Yellow's light-mode variant: `#8B6F00`.** `#EDDD6E` measures roughly 1.4:1 against this app's
light-mode `--card` (white) — a real failure, the same category as indigo's above, just the opposite
mode: an earlier pass checked yellow only against the _dark_ background (14.2:1, fine) and never
checked it against light, which is what actually shipped the bug. `#8B6F00` measures 4.80:1 against
white: darker, still clearly yellow/gold rather than drifting to brown or olive. Use `#8B6F00` for
yellow whenever light mode is active (including "no explicit choice", since that resolves to light),
`#EDDD6E` in dark mode. **Never use the light-mode-unsafe `#EDDD6E` value directly in a component**
— go through the `--color-cat-yellow` token, which already resolves to the correct one per mode.

**Burnt vermillion and rose violet must never appear together in the same view.** Both are warm,
mid-saturation tones (vermillion an orange-red, violet a rose-pink), and side by side — especially
as small swatches, icons, or thin marks rather than large patterned fills — they read as confusably
similar, particularly for a colorblind viewer relying on warmth/saturation over exact hue.
Vermillion is outcome-exclusive already (see below), so this mostly means: don't reach for violet on
a screen that also shows an unforced-error color anywhere in view.

**Indigo next to vermillion has the same problem, but only at small/tight scale.** The Serve tab's
outcome bars originally paired vermillion (fault) with indigo (ace) as two adjacent segments in one
thin stack, and that combination was reported back as still hard to tell apart in practice — despite
indigo sitting comfortably far from vermillion elsewhere in the app (e.g. the surface record card's
loss count next to a clay panel). The difference is scale and adjacency: a small swatch, icon, or
thin bar segment sitting directly against a vermillion one loses the separation a larger or more
separated indigo fill keeps. Reach for **yellow** first whenever a new categorical color has to sit
immediately next to vermillion in a tightly-packed bar, legend, or swatch group — indigo is still
fine as a categorical color generally, just not as vermillion's direct neighbour at that scale.

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
- **Squad stats — leaderboard percentage bars / Trend line** — not single-series in the sense the
  row above means: both are one chart/visual switched between the same three metrics (Win percentage
  / Forced:Unforced / First serves landing in play) via a filter chip, not one fixed measurement.
  Each metric gets its own color from the safe non-outcome set (yellow / indigo / violet), shared
  between the leaderboard's own fill bar and the trend line so a metric is always the same color
  everywhere it appears on that page. Avoid blue — the bottom nav is visible on this page.
  Forced:Unforced is the one exception: its leaderboard chip is a levelling-tool needle, not a fill
  bar, and stays on the outcome palette (forced/unforced) rather than this categorical one, since
  it's a genuine outcome pair, the same choice the player card's own needle already makes. The trend
  line's stroke can't show a hatch texture at 2px, so it carries a per-metric dash style instead
  (solid / dashed / dotted) as this rule's line-shaped equivalent. The Spread histogram this page
  used to have is gone (removed as not useful enough to keep); don't reintroduce an SVG `<pattern>`
  fill for a bar chart on this page without a real caller for it again.
- **Serve/Rally toggle** (`serve-rally-toggle.tsx`) — not a categorical chart, so it isn't governed
  by the safe non-outcome set above: this is nav blue's own documented role, "active tabs," applied
  literally. Deliberately not built on the shared `SegmentedControl`, whose active state is a muted
  gray everywhere else it's used (surface, format, trend window) — this one switch needed a louder,
  obviously-interactive active state without changing that shared default for every other toggle.
- **Serve tab — outcome bars ("Your serve" and "Return of opponent serve")** — win (in), unforced
  (fault or error) and **sky** for ace (see "Serve/Rally — sky" below). Both indigo and yellow were
  tried here first and reported too close to vermillion's "fault" segment sitting right next to it
  in this thin bar — treat "no vermillion next to indigo or yellow in a tightly-packed bar/legend"
  as a real constraint alongside the existing vermillion/violet one, not a one-off fix. Violet is
  off the table outright (vermillion/violet must never share a view).
- **Serve tab — fault-mode courts** (`fault-mode-court.tsx`) — majority-vs-not, not a seventh
  category: whichever fault mode (net/long/wide) has the largest share, plus any other within 10
  points of it, carries vermillion with its usual diagonal-band pattern (the same "the one to
  address" reasoning as an unforced error elsewhere on the dashboard). Everything else is a flat,
  unpatterned **light indigo** — `color-mix(in oklch, #2E1A47 42%, white)`, indigo's light-mode hex
  specifically rather than the `--color-cat-indigo` token, since the court itself is always
  literally white regardless of app theme (like the surface record card's own mask) and mixing the
  already-lightened dark-mode indigo would wash out further against a background that never darkens
  with it. No pattern on the minority fill: it is a de-emphasised "not the one to look at" rather
  than a second competing category, so it doesn't need the categorical palette's usual
  pattern-redundancy treatment. Blue is off the table for the same cross-page reason as the outcome
  bars above.
- **Serve/Rally — sky.** A scoped **8th categorical color**, not one of the documented seven above,
  shared by exactly two swatches: the Serve tab's Ace segment and the Rally tab's wing-split
  Backhand segment (Forehand stays yellow there). Both started as separate problems — Ace tried
  indigo then yellow next to vermillion's "fault," Backhand tried indigo next to Forehand's yellow —
  and both failed for the same underlying reason (too close to a neighbour at this small a swatch
  scale), so rather than searching for a third and fourth new color, sky is the one common-ground
  color used in both places. The exact hue requested is **#00E5FF** (186°) — used exactly in dark
  mode, where it measures 12.82:1 against the background. Light mode uses **#0093A3**, the same 186°
  hue darkened until it clears the 3:1 floor against white (3.68:1): #00E5FF itself measures only
  1.54:1 there, the same class of failure yellow's and indigo's own light-mode tokens were already
  fixed for, not a stylistic downgrade of the requested color. Distinct from nav's own primary blue
  (a separate token, a separate meaning) and reachable here specifically because neither of Ace's or
  Backhand's screens puts this swatch pixel-adjacent to actual nav chrome. Violet and true nav-blue
  reuse are still off the table for the usual reasons (vermillion visible on both cards; nav blue
  means brand/interactive everywhere, categorical color nowhere). Its pattern is thick, widely
  spaced vertical white columns (24px tile, 8px column, generous negative space) — the same
  vertical-band motif family as win-green's own pattern, deliberately a much wider tile so the two
  stay apart by scale. This is a scoped exception for these two swatches, not a general 8th addition
  to the categorical palette — don't reach for sky as a first choice elsewhere without hitting the
  same dead end these two did.
- **Rally tab — "Final ball: where it landed"** (`final-ball-court.tsx`) — outcome-themed
  majority-vs-not, not the continuous single-hue heat gradient this chart used before: whichever
  in-court zone(s) hold the largest share, plus any other within 10 points of it, carry the outcome
  color for whichever side the open style drill is scoped to — win-green for a style scoped to
  points the tracked player won, vermillion for one scoped to points they lost, each with its own
  established pattern (vertical bands / diagonal bands) rather than a fresh one. Everything else is
  the same flat, unpatterned light indigo `fault-mode-court.tsx` uses for its own non-majority fill
  — a de-emphasised "not the one to look at," not a second competing category. Net, long and wide no
  longer appear on this chart at all (that breakdown moved to the Serve tab's own fault-mode
  courts), so `--chart-1`'s old non-categorical gradient role here is gone with them.
- **Rally tab — rally-intensity hypnogram** (`rally-hypnogram.tsx`) and **rally intensity chart**
  (`rally-intensity-chart.tsx`) — one bar per recent match (hypnogram) or per game within one match
  (intensity chart), coloured by that match's or game's own outcome: win-green, loss-vermillion, or
  (hypnogram only) a neutral `--muted-foreground` grey for a match nobody has recorded the result of
  yet, never guessed at. A won bar is a plain, fully solid fill; a lost bar carries the same
  high-contrast diagonal-stripe texture the rest of the app already uses for a loss
  (`pattern-unforced` for a hand-rolled div bar, `LossPatternDefs`/`"url(#chart-pattern-loss)"` for
  a Recharts SVG one) — a deliberate departure from this chart family's earlier flat-fill-only bars,
  since here a single bar has no adjacent bar of the other colour to compare against, so colour
  alone isn't enough to read win vs. loss in grayscale. "Went the distance" (reached a deciding set
  or a match tiebreak) is a genuinely independent fact on the hypnogram — a match can be short and
  still have gone to a decider — so it draws as a small amber diamond marker above the bar rather
  than a competing bar colour. This is a deliberate, narrow exception to
  "orange/`--color-outcome-forced` is reserved for point outcomes and hero-metric score bands, never
  anything else": the marker is an annotation layered on top of the real categorical fill, not a
  competing swatch or legend colour in its own right, the same reasoning that already lets
  vermillion carry an extended "the one to address" meaning on the Serve tab's fault-mode courts.
  Don't extend this further (a fifth meaning for orange) without the same care.
- **Player profile — surface record card** (`player-surface-record-card.tsx`) — no longer a
  categorical choice at all: each panel is painted the real court colour capture itself uses
  (`SURFACE_PATTERN_CLASS` in `tennis-labels.ts`, mirroring `live-match.tsx`'s own `COURT_SURFACES`
  — `--color-court`/`-grass`/`-clay`/`-carpet`), not a swatch from the categorical palette above. A
  surface's colour is what it visibly is on a real court, not a category needing pattern-redundancy
  the way the rainbow palette does — the icon and label under each panel are what tell two panels
  apart without relying on colour alone, the same non-color-channel principle in a different form.
  Never let a surface default to an outcome color (win/forced/unforced) regardless. The win rate
  itself is a plain white mask scaling up from each panel's own bottom edge, not a second fill, so
  it carries no color of its own.

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

**"Check" means compute the actual WCAG contrast ratio, not eyeball it.** A color that looks fine in
an editor's swatch preview can still measure under 3:1 (the WCAG minimum for a graphical object like
a chart line or icon) against this app's actual dark-mode background — `oklch(0.148 0.004 228.8)`, ≈
`#090b0c`. This is exactly how indigo's original `#2E1A47` (1.27:1, a real failure) went unnoticed
until reported, while violet's `#D9569E` (5.42:1) turned out to already be fine. Compute it: convert
both colors to sRGB (an OKLCH color needs its L/C/H run through the standard OKLab→linear-sRGB
matrices first), take each color's relative luminance, and apply the standard WCAG contrast formula
`(L1 + 0.05) / (L2 + 0.05)` with `L1` the lighter of the two. Do this for both the light-mode and
dark-mode background before deciding a new or edited color is safe — a quick script (Python, or a
browser contrast-checker) is enough; don't rely on visual impression alone, since a color's apparent
brightness on screen and its computed contrast ratio can disagree by a wide margin, especially for
saturated purples and blues.

**Applies to Recharts marks too, not just HTML swatches.** A thin chart `Line` stroke, `Bar` fill
edge, or point dot needs the same separation from its background that `swatch-halo` gives an HTML
box — a `box-shadow` ring doesn't apply to an SVG stroke, so the equivalent there is a halo pass:
render the mark twice, a wider `stroke="var(--background)"` pass first (self-adjusting per theme,
reusing the existing background token rather than a fixed color), then the real colored mark on top
at its normal width. A filled dot gets the same effect from its own `stroke` set to the background
color at a couple of pixels, no second element needed. This is why violet (`#D9569E`, already 5.42:1
against the dark background) can still read as "hard to see" as a 2px line despite passing the raw
contrast check on its own — thin strokes lose effective contrast that a filled swatch of the same
color doesn't, and the halo is what recovers it.

**No two lines drawn together may share stroke width or stroke style.** Whenever a visual shows two
or more line strokes at once (two arcs, two trend lines, two chart series drawn as lines), each one
needs a genuinely different thickness **and** a genuinely different dash pattern (solid, dashed,
dotted — not just a different color), the same non-color-channel requirement the pattern rule
already applies to filled swatches, extended to strokes specifically. Matching on either channel
alone still isn't enough — two lines both solid at different widths, or both the same width in
different dash patterns, still read as "the same kind of line, just resized/recolored" at a glance;
only varying both together reads unambiguously as two distinct lines. Reusing the same thickness and
the same solid/dashed/dotted style for two lines and separating them by hue alone fails a colorblind
viewer exactly the way an unpatterned swatch does. Example: `player-card.tsx`'s rally-length
flight-path arcs — Won is solid and thicker, Lost is dashed and thinner, on top of their
win/unforced colors, never color alone.
