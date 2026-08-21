# Color Palette

The rule itself — the hex values, the pattern assignments, and the "never reuse a color for two
roles" constraint — lives in [.claude/rules/web-color.md](../.claude/rules/web-color.md) and applies
to every screen without being asked. This document is the reasoning behind those choices, kept out
of the rule file because a rule Claude re-reads on every UI change should stay short and directive,
not carry a design essay.

## Why a fixed palette at all

MatchPoint's analytics dashboard is the whole point of the app (per the assignment brief): serve
percentages, rally-length win rates, trends across matches, opponent comparisons. All of that is
read as color before it's read as a number. A coach scanning a chart mid-session doesn't have time
to parse a legend twice. That only works if a color means the same thing everywhere it appears, and
if the palette itself doesn't quietly exclude coaches with color vision deficiency (CVD), which is
common enough (~8% of men) that "works for the designer's eyes" isn't a real bar.

## Navigation color: why blue is exclusive to chrome

Deep blue (`#045C8C`) is the one color reserved for brand and interactive state: nav bars, active
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

### Two tokens, not one: why dark mode gets its own blue

Human vision has fewer cone receptors dedicated to blue than to red or green, so blue reads as
perceptually darker than its luminance number alone suggests. That gap widens specifically against a
near-black background, where `#045C8C` loses more contrast than its numbers imply. Every other color
in this file is a chart swatch, which is transient, on screen for as long as one chart is. The
nav/brand color is not: it's present on every screen, permanently, so a contrast loss there is a
standing cost rather than a one-off.

Rather than compromise the light-mode value to make one hex survive both themes, dark mode gets its
own token, `#1E88C7` — same semantic role, same restriction (chrome and interactive state only,
never a category color), just lighter to hold its contrast where `#045C8C` would fade. This is the
one place in the file where the rule deliberately keeps two hexes for one role instead of insisting
on a single source of truth, because the alternative is a color that's correct in one theme and
wrong in the other.

## Categorical palette: built on Okabe–Ito, then corrected against how it's actually seen

The seven-color sequence started as a deliberate adaptation of the
[Okabe–Ito color-universal-design palette](https://jfly.uni-koeln.de/color/) (Okabe & Ito, 2008),
the standard reference palette for charts that must stay distinguishable under protanopia and
deuteranopia — the two most common forms of red-green color blindness. Building on a tested palette
rather than inventing hues from scratch, and leaning on lightness/saturation as a second channel
alongside hue, was the starting discipline. But a formula or a simulation is only ever a proxy for
how an actual colorblind viewer experiences the palette — the sequence went through two further
rounds of correction once it was checked against that, and both left marks on the current hexes.

**Round one: two confusions found in practice.** Hue-and-lightness tuning alone still left amber
easy to mistake for mustard, and a paler, dustier violet easy to mistake for blue. Neither was fixed
with a small nudge:

- **Amber vs. mustard** needed the lightness gap between orange and yellow widened substantially,
  not incrementally — a small correction wasn't enough separation to survive real viewing conditions
  (a legend chip, a thin chart line), only a deliberately large one was.
- **Orchid vs. blue** turned out to be about which color channel was doing the separating work. A
  pale, desaturated purple depends on its red component to read as distinct from blue — and red
  contribution is exactly what red-green color vision deficiency compromises. The fix wasn't to
  shift hue incrementally either: it was to push violet toward a more saturated magenta, restoring
  enough red weight to stay a color, not a shade of blue, once that channel is degraded. That's why
  the current violet (`#D9569E`) reads as a definite rose/magenta rather than a pastel purple — the
  softer version was the one that failed.

**Round two: a grayscale audit caught what hue tuning couldn't see.** The working test adopted was
blunt on purpose: does the palette still separate in black and white? Two colors can sit far apart
in hue and still land close together in relative luminance (`0.299R + 0.587G + 0.114B`), and for
more severe color vision deficiency, luminance, not hue, is what actually carries the separation.
Auditing the palette this way found red and green only 13 points apart on a 0–255 scale, and blue
and violet only 11 apart — both functionally the same shade once hue is discounted, despite reading
as obviously different colors to typical vision.

- **Red and green** were corrected together, not one at a time: red darkened to Burnt vermillion
  (`#9C3D0A`), green lightened to Jade green (`#1FBF8C`), moved in opposite directions
  simultaneously so that closing the gap between them didn't just push one of them into collision
  with whichever color sits on its _other_ side in the sequence.
- **Blue and violet** were corrected asymmetrically, deliberately. Blue was left at `#045C8C`
  because it does double duty as the fixed nav/brand color (see above) — nudging it for luminance
  reasons would ripple into every piece of UI chrome in the app, not just this one chart pairing.
  Violet alone was lightened instead, to Rose violet (`#D9569E`), carrying the full weight of the
  separation so blue didn't have to move at all.

**What's unchanged from Okabe–Ito.** Orange (`#E69F00`) survived both rounds of correction untouched
— it was never the color implicated in either confusion. Yellow (`#EDDD6E`) is still Okabe–Ito's
yellow (`#F0E442`) paled for the same reason as always: the original is a pure, high-luminance
yellow that's close to unreadable as text or a thin pattern mark on white, and paling it trades a
little hue purity for a shade that leaves the cross-hatch pattern room to actually show up.
Okabe–Ito's own blue (`#0072B2`) and its separate sky-blue swatch remain dropped in favor of the
brand blue anchoring the sequence, for the reason given above: two similar blues, one for chrome and
one for data, is exactly the confusion this file exists to prevent. **Indigo** (`#2E1A47`) still has
no Okabe–Ito equivalent — it fills the seventh step left open once sky-blue was dropped, sitting at
the dark end of the range specifically because nothing else in the palette occupies that lightness.

## Sequential scale: why a strength meter gets its own third concept

The rule originally had two concepts: brand/nav (blue, exclusive) and categorical (the seven-color
rainbow, for unordered distinct values). Neither fit a password strength meter: strength is one
ordinal quantity running from weak to strong, not a set of categories with no inherent order.
Forcing it into the categorical palette would have been actively misleading: a distinct hue per
strength step reads as "these are different kinds of thing," when the actual message is "this one
thing is getting better or worse."

The fix reuses three existing categorical hexes (Burnt vermillion, Orange, Jade green) as
interpolation anchors rather than inventing a fourth palette concept from scratch. This mirrors the
navigation color's precedent: `#045C8C` already carries two documented roles (nav/brand and a
categorical swatch), so a color carrying a second role, clearly scoped to when each applies, was
already an accepted pattern in this file rather than a new kind of exception. The alternative — a
dedicated sequential-scale palette with its own hexes — would mean auditing a fourth set of colors
against light/dark backgrounds and CVD simulation, for one meter, when the categorical palette's red
and green already passed that audit and sit at the right ends of a weak→strong story.

The fill is a continuous interpolation, not discrete steps, because a severity scale's whole value
is showing _how far along_ the scale a value sits, and five discrete swatches would visually
reintroduce the categorical palette's "these are different things" reading, exactly what a
sequential scale needs to avoid. Two linear segments (vermillion→orange, orange→green) rather than
one direct vermillion→green blend, so the midpoint actually passes through orange rather than a
muddy brown average of the two endpoints.

The categorical palette leans on a pattern overlay so a swatch stays legible without color. A thin
progress-bar fill has no width to carry a pattern mark. The meter already renders a text label
("Weak", "Strong") below the bar for an unrelated reason — this scale treats that label as the
non-color channel a pattern would otherwise provide, rather than adding a second, redundant
mechanism for the same job.

## Dashboard color roles: why point outcomes get their own exclusive reservation

Green, red, and orange already carried two roles before this — a categorical swatch, and (once the
password strength meter shipped) a sequential-scale anchor. Extending them to also mean "point
outcome" on the analytics dashboard wasn't adding a third, unrelated meaning grafted onto the same
three hexes: the strength meter's weak → strong fill is already a good/neutral/bad score band, the
exact same semantic a WHOOP-style hero metric or a point-outcome tally uses. The dashboard rule just
names that pattern explicitly and locks it down, rather than leaving it as an implicit coincidence
that the next chart built might not notice and quietly break.

Locking it down matters because outcome meaning is exactly the kind of thing a coach needs to read
at a glance, mid-session, without parsing a legend — the same scannability argument that keeps blue
nav-exclusive. If green sometimes means "won the point" and sometimes means "category 4 in an
unrelated legend," a coach has to stop and check which chart they're looking at before the color
means anything. Reserving green/red/orange for outcomes and score bands only, and pulling every
other categorical need from a separate "safe" set (yellow, indigo, violet, plus blue when nav chrome
isn't in view), keeps that one glance reliable everywhere it appears on the dashboard.

The per-chart assignments follow directly from what each chart is actually showing, not from a
uniform rule applied blindly. Single-series charts (a distribution histogram, a scatter with one
trend line) get no categorical color at all, because there's nothing to distinguish — reaching for a
palette color there would imply a category distinction that doesn't exist. Two-series comparisons
(the H2H radar overlay, the journal correlation panel) get two colors from the safe set; the
three-line H2H slope graph gets three. The slope graph's specific call to avoid blue — even though
blue is otherwise in the safe set — isn't a special exception invented for that screen: it's the
same nav-chrome-visibility rule from the Navigation color section above, applied to the one
dashboard screen where nav chrome and a data chart actually share the view.

## Why every color also needs a pattern

A colorblind-safe, luminance-audited hue selection is not enough on its own. It protects against
confusing two _different_ hues, but it does nothing for:

- **Total color blindness (achromatopsia)** or a grayscale printout — the rarest case, but the one
  every other safeguard in this file still fails silently against unless something _other_ than hue
  distinguishes the swatches.
- **Small marks and thin lines**, where even a well-separated hue pair can become indistinguishable
  once the colored area is a few pixels wide (a legend chip, a thin trend line).
- **Screens and printers with poor color reproduction**, which compress the palette's carefully
  chosen gaps without warning.

Patterns are a second, fully independent channel — legible on shape alone, with no dependency on hue
perception at all. That's why the rule is explicit that color alone never satisfies it: the pattern
isn't decoration, it's the fallback that keeps the palette working when color itself fails. Marks
are held to a bold, high-opacity range rather than a subtle texture on purpose: a faint texture only
reads once the color underneath it has already been interpreted, which defeats the point of an
independent channel — a genuinely independent signal has to be legible entirely on its own.

## Why these specific patterns, sizes, and densities

Three motifs cover all seven colors — bands, dots, and cross-hatch — rather than seven unique
patterns, because a large pattern vocabulary is its own legibility problem: a coach shouldn't have
to memorize seven arbitrary textures. Within that constraint, each motif now separates its colors on
three independent properties at once — direction/rotation, mark color, and tile scale/density —
rather than one or two:

- **Bands (red, blue, green)** — red and blue share the same diagonal-band sub-motif, mirrored in
  rotation (45° vs. −45°) as before, but now also differ in scale: red's is a coarse 10×10px tile,
  blue's a fine 6×6px tile. Green sits in the same broad family with a third variant, vertical
  rather than diagonal bands, at an 8×8px tile. Three colors sharing one motif family stay
  distinguishable through rotation, orientation, _and_ density stacked together, not any single one
  of them carrying the whole load.
- **Dots (orange, indigo)** — identical circular geometry, separated by mark color (black on orange,
  white on indigo), a large lightness gap, and now also scale: orange's dots are large and sparse
  (14×14px tile, 3px radius), indigo's small and dense (8×8px tile, 1.5px radius). A viewer who's
  lost the color difference entirely can still tell them apart by how coarse or fine the dot field
  reads.
- **Cross-hatch (yellow, violet)** — the same logic again: identical X geometry, separated by mark
  color (black on yellow, white on violet), a large lightness/saturation gap, and density — yellow's
  hatching is coarse (12×12px tile, 2.5px stroke), violet's fine (6×6px tile, 1.5px stroke).

Density earns its place as a third channel because it's genuinely independent of the other two: two
colors can share a motif's shape and even its rotation and still read apart purely on how coarse or
fine the repeating tile is, which is why the rule requires it to vary within every shared-motif
pair, not just for the pairs that happen to need a tie-breaker.

Per-swatch ink color (black vs. white) is still chosen for contrast against that swatch's own base
color, not applied uniformly — a fixed ink color would look strong on some swatches and disappear on
others, especially now that several base hexes have shifted from the original palette.

## Why every swatch also needs a dual-ring halo, not a single border

The original approach used one fixed border tone, checked case by case against light and dark
backgrounds. That check is exactly the weak point: a border tuned to survive a white page can still
fail against a true dark-mode background, or the reverse, because a single tone only guarantees
contrast against backgrounds on one side of the lightness spectrum. Getting it right meant either
picking a border color conditionally per theme (more logic, another place to get the condition
backwards) or accepting that some future addition would eventually land on the wrong side of the
check.

The fix removes the condition instead of trying to satisfy it better: every swatch and every pattern
mark now carries both a white inner ring and a black outer ring at once, always, rather than one
theme-appropriate tone chosen at render time. This is structurally background-agnostic — one of the
two rings will always contrast against whatever is behind it, because a background can't be both
near-white and near-black at the same time. No theme detection, no per-color exception, and nothing
that can be forgotten when the next color is added.

Every new or edited color still needs checking against both a light and a dark background before it
ships — the halo guarantees the boundary stays visible, not that the fill itself is legible in both
modes, which is a separate property the rest of this document's reasoning already covers.
