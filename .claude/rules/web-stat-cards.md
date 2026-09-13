---
paths:
  - apps/web/**
---

# Glanceable stat cards

This is an always-on constraint, not a workflow to invoke. Applies to any card or row whose job is
showing a coach a handful of numbers they need to read in a couple of seconds, courtside — the
Players tab's roster card (`features/players/player-card.tsx`) is the reference implementation this
file was written against.

## Every stat is bold, sized to be read at a glance, and carries an icon

A card built for a quick courtside glance fails if any of its numbers or labels are small, thin, or
muted — that's the exact opposite of what "glanceable" means. For every stat row or card heading:

- **Label and value are both bold**, and both at least `text-sm` (`text-base` for a card's own
  title, e.g. a player's name). Never `text-xs`, and never `text-muted-foreground` on the label of a
  stat that's meant to be a headline figure — muted/small is for a genuinely secondary caption (a
  scope note, a sample-size footnote), not for the stat itself.
- **Every stat gets an icon**, not just some of them — a bare number with no icon is the thing to
  avoid, and a row that's "just text" next to rows that have icons reads as unfinished rather than
  deliberately plain.
- **The icon must already mean this concept elsewhere in the app, or be added to
  `.claude/rules/web-icons.md` in the same change.** Before reaching for an icon that merely looks
  plausible, check that file's tables for the concept first. If an _existing_ assignment feels wrong
  for a new use (doesn't read intuitively, e.g. a icon that technically matches the data but doesn't
  suggest the right idea at a glance), that is a conversation about changing it everywhere it's
  used, not a reason to pick a different icon for just the new call site — two icons for one concept
  is the exact failure mode that file exists to prevent. Flag the concern and ask, rather than
  silently diverging in one place.

## A magnitude visual, matched to what the number actually is

Every stat needs a visual proportional to its size, not just an icon — and the _shape_ of that
visual has to match the kind of quantity it is:

- A **share of a fixed total** (a percentage, 0–100) gets a single fill bar against that ceiling.
- A **ratio or two-way split** (forced vs. unforced, won vs. lost) gets a two-segment proportion bar
  (`OutcomeStack`), not a single fill — a single bar can't show a balance between two counts.
- **Several comparable quantities** (rally length won vs. lost, a shot-type breakdown) read better
  as **vertical columns on one shared ceiling** than as stacked horizontal rows — a horizontal row
  turns "which is bigger" into a ruler measurement; columns side by side make it a single glance.
  See `features/players/column-chart.tsx`.
- Colour still follows `.claude/rules/web-color.md` on top of this: a true point outcome or good/bad
  score band gets the outcome palette (green/orange/vermillion); anything else gets the safe
  categorical set (yellow/indigo/violet), never blue where nav chrome is visible on the same screen.

## Building a custom column/bar chart: known pitfalls

If `BreakdownBars` (horizontal) or `OutcomeStack` (two-way split) don't fit and a new hand-rolled
bar visual is genuinely needed, two specific mistakes are easy to make and both actually happened
once:

- **A bar's height must never be a CSS percentage against an ancestor with no definite height.** A
  flex column sized by its own content (icon + value + caption) has no definite height itself, so a
  child at `height: N%` silently collapses to zero — it has nothing to be a percentage _of_. Give
  the bar's own container a real pixel height (a prop, not a hardcoded constant, so different charts
  on the same screen can share one) and compute the fill in pixels directly.
- **Multiple columns in one row must be top-aligned (`items-start`), not bottom-aligned.** A caption
  that wraps to two lines makes that one column taller overall; bottom-aligning the row shifts that
  column's bar zone up relative to the others, breaking the shared baseline the whole chart exists
  to show. Top-aligning means every bar zone — a fixed height, first in each column — starts at the
  same Y regardless of what its caption does underneath it.
- **A column's bar must have a fixed width, never `w-full`.** A chart with fewer columns (one per
  side, say, instead of two sharing a row) would otherwise stretch its one bar to fill the whole
  column, reading as a heavier, thicker mark than the exact same chart with more columns in it — a
  bar's thickness is not information and must never vary with how many columns happen to share the
  row. Bars stay thin and a fixed width regardless of column count; only height encodes the value.
- **When two separate chart instances sit side by side and are meant to read as one comparison**
  (e.g. two different stats each rendered as its own column chart), they must share the exact same
  bar-zone height _and_ the exact same heading-row height, or their value/caption rows land at
  different vertical positions even though each chart is internally correct. Give shared headers a
  fixed height (e.g. a literal `h-7`) rather than trusting that differently-shaped header content
  (an icon plus text vs. text plus a legend) happens to render at the same natural height — it won't
  in general, only close enough to look wrong.

## One action, one affordance

Never give a stat card two different controls that do the same thing. If a card has a dedicated
action button for "go to the detail view" (a footer link, e.g. "View stats"), the rest of the card —
its header row, an avatar, a chevron implying navigation — must not _also_ navigate there. Two
affordances for one action reads as a bug (does the header do something different from the button?)
even when both happen to go to the same place. Pick the one clear affordance and make everything
else on the card genuinely inert.

## Section dividers on a data-dense card need real visual separation

The default 1px `border-t` (or `Separator`) is tuned for a normal list row and reads as too subtle
once a card is showing several distinct stat groups stacked vertically — a coach scanning fast needs
the groups to look obviously separate, not merge into one block of numbers. Use a visibly thicker,
higher-contrast divider between stat groups on this kind of card specifically
(`border-t-2 border-muted-foreground/40` is the value used in `player-card.tsx`) — this is a
deliberate exception to the plain 1px default elsewhere in the app, not a new baseline for every
divider in the codebase.
