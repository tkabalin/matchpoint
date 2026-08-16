# Color Palette

The rule itself — the hex values, the pattern assignments, and the "never reuse a color for two
roles" constraint — lives in [.claude/rules/web-color.md](../.claude/rules/web-color.md) and applies
to every screen without being asked. This document is the reasoning behind those choices, kept out
of the rule file because a rule Claude re-reads on every UI change should stay short and directive,
not carry a design essay.

## Why a fixed palette at all

MatchPoint's analytics dashboard is the whole point of the app (per the assignment brief): serve
percentages, rally-length win rates, trends across matches, opponent comparisons. All of that is
read as color before it's read as a number — a coach scanning a chart mid-session doesn't have time
to parse a legend twice. That only works if a color means the same thing everywhere it appears, and
if the palette itself doesn't quietly exclude coaches with color vision deficiency (CVD), which is
common enough (~8% of men) that "works for the designer's eyes" isn't a real bar.

## Navigation color: why blue is exclusive to chrome

Deep blue (`#045C8C`) is the one color reserved for brand and interactive state — nav bars, active
tabs, links, primary buttons. It is deliberately excluded from being reused as a category or status
color, even though it's also part of the categorical palette below. The reasoning is scannability,
not aesthetics: if blue means "primary action" in one part of the screen and "category 5" in a chart
two inches away, a coach's eye can no longer use color as a shortcut at all — they'd have to read
every label to know which meaning applies. Keeping one color permanently reserved for chrome is what
lets every other color stay meaningful as data.

This is also why the rule calls out the one unavoidable collision: deep blue is _also_ the bluest
step in the categorical sequence, because a 7-hue colorblind-safe rainbow needs a blue step and this
app already has a "the" blue. Rather than maintain two near-identical blues (one for chrome, a
different one for data) and risk them being mistaken for each other, the rule accepts the overlap
and instead forbids using blue as a category color on any screen where navigation chrome is visible
in the same view — the one case where the collision could actually mislead someone.

## Categorical palette: built on Okabe–Ito, not invented from scratch

The seven-color sequence is a deliberate adaptation of the
[Okabe–Ito color-universal-design palette](https://jfly.uni-koeln.de/color/) (Okabe & Ito, 2008),
the standard reference palette for charts that must stay distinguishable under protanopia and
deuteranopia — the two most common forms of red-green color blindness. Three of its colors are used
unchanged:

| Okabe–Ito name | Hex       | Used as |
| -------------- | --------- | ------- |
| Vermillion     | `#D55E00` | Red     |
| Orange         | `#E69F00` | Orange  |
| Bluish green   | `#009E73` | Green   |

Three more are deliberately adapted rather than copied verbatim:

- **Yellow** — Okabe–Ito's yellow (`#F0E442`) is a pure, high-luminance yellow that reads well on a
  chart background but is close to unreadable as text or as a thin pattern mark on white — there's
  almost no lightness gap left to work with. The palette pales it to `#EDDD6E`, trading a little hue
  purity for a shade that still passes as "yellow" while leaving room for the black cross-hatch
  pattern to actually show up against it.
- **Blue** — Okabe–Ito's blue (`#0072B2`) is a distinct color, but this app already has a brand
  blue. Rather than run two similar blues that a coach would have to learn apart, the categorical
  blue step _is_ the brand blue (`#045C8C`), deepened slightly from Okabe–Ito's version so it reads
  as clearly a "brand" shade rather than a generic chart blue. Okabe–Ito's separate sky-blue swatch
  is dropped entirely — once the brand blue anchors one end of the palette, a second, lighter blue
  sitting right next to it would undercut the exact scannability goal the palette exists for.
- **Reddish purple → Violet** — Okabe–Ito's reddish purple (`#CC79A7`) is intensified to a more
  saturated magenta (`#C13584`) for stronger separation from the paled yellow and from indigo, both
  of which sit near it in the sequence.

**Indigo** (`#2E1A47`) has no Okabe–Ito equivalent — it's an addition needed to fill out seven
distinguishable steps once sky-blue was dropped in favor of the brand-blue substitution above. It
sits at the dark end of the range specifically because nothing else in the palette occupies that
lightness, which is what keeps it from being confused with violet or blue under any form of CVD.

## Why every color also needs a pattern

A colorblind-safe hue selection is necessary but not sufficient. It protects against confusing two
_different_ hues, but it does nothing for:

- **Total color blindness (achromatopsia)** or a grayscale printout — the rarest case, but the one
  every other safeguard in this file still fails silently against unless something _other_ than hue
  distinguishes the swatches.
- **Small marks and thin lines**, where even a well-separated hue pair can become indistinguishable
  once the colored area is a few pixels wide (a legend chip, a thin trend line).
- **Screens and printers with poor color reproduction**, which compress the palette's carefully
  chosen gaps without warning.

Patterns are a second, fully independent channel — legible on shape alone, with no dependency on hue
perception at all. That's why the rule is explicit that color alone never satisfies it: the pattern
isn't decoration, it's the fallback that keeps the palette working when color itself fails.

## Why these specific patterns, sizes, and opacities

Three motifs cover all seven colors — diagonal bands, dots, and cross-hatch — rather than seven
unique patterns, because a large pattern vocabulary is its own legibility problem: a coach shouldn't
have to memorize seven arbitrary textures. Each motif is reused by exactly two colors, separated so
the reuse never becomes ambiguity:

- **Bands (red, blue)** — mirrored rotation, 45° vs. −45°. These two are the ones sharing a linear
  motif, so the rotation is flipped specifically so red and blue stay visually distinct even under
  total hue loss, where "diagonal band" alone wouldn't be enough.
- **Dots (orange, indigo)** — identical geometry, separated instead by mark color (black marks on
  orange, white marks on indigo) and by the large lightness gap between a light color and a very
  dark one. Two separating channels rather than one, since dots have no rotation to differentiate
  them the way bands do.
- **Cross-hatch (yellow, violet)** — the same logic as dots: identical X geometry, separated by mark
  color (black on yellow, white on violet) and by the two colors sitting far apart on the lightness
  and saturation scale.

The tile sizes follow directly from what each mark needs to stay legible: dots get a larger 10×10px
tile (a circular mark needs more surrounding space to read as a distinct shape than a straight line
does), while the linear motifs (bands, cross-hatch) use a tighter 8×8px tile. Band width is set to
exactly half the tile — a 50% duty cycle — because that's the ratio least likely to either vanish
(too thin) or read as a near-solid fill (too thick) at UI scale.

Per-swatch ink color (black vs. white) is chosen for contrast against that swatch's own base color,
not applied uniformly — a fixed ink color would look strong on some swatches and disappear on
others. Marks are also held to a real, visible opacity range (40–50%) rather than a subtle texture:
a pattern that only shows up on close inspection defeats the point, which is a difference
perceivable at a glance.

## Why every swatch also needs a border

A fill color's contrast against its background isn't fixed — it depends entirely on what's behind
it, and this app supports both light and dark display modes. The palest color in the set (pale
yellow) can nearly disappear on a light background; the darkest (indigo) can nearly disappear on a
dark one. A pattern fill doesn't fully solve this either, since a mark drawn _inside_ a swatch is
still bounded by that same low-contrast edge.

A mandatory 1px border is the cheapest fix that doesn't depend on the fill color at all: it
guarantees a swatch's boundary is always perceivable, regardless of which of the seven colors is
used or which mode the coach is in. This is also why the rule requires checking every _future_
addition against both light and dark backgrounds specifically — a color's contrast behavior in one
mode says nothing about the other, so a check done once, in one mode, is a false guarantee.
