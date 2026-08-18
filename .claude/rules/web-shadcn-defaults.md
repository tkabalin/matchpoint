---
paths:
  - apps/web/**
---

# shadcn defaults

This is an always-on constraint, not a workflow to invoke. Every shadcn component generated via the
CLI, and every one already in `src/components/ui/`, must conform to these defaults — no per-screen
or per-component one-offs. `.claude/skills/shadcn/` documents how shadcn and Base UI work generally
and what's actually installed; this file is the prescriptive list of which choices this project has
made, so nothing has to be re-derived or guessed per change.

## Style and primitives

**`base-luma`, built on Base UI (`@base-ui/react`), not Radix.** Older shadcn examples target Radix
and won't apply verbatim — see `.claude/skills/shadcn/rules/base-vs-radix.md` for the API
differences (`render` instead of `asChild`, etc.).

## Base color

**`mist`** (`components.json`'s `baseColor`). Don't switch base color per component or screen.

## Theme

**Brand blue** — `#045C8C` light mode, `#1E88C7` dark mode, per `.claude/rules/web-color.md`. The
`--primary` token should resolve to these exact values in both modes.

> Known gap, not yet fixed: `app.css`'s dark-mode `--primary` is currently
> `oklch(0.394 0.086 241.939)` ≈ `#0D4B70` — a different, darker blue than the documented `#1E88C7`.
> Light mode's `--primary` (`oklch(0.455 0.106 241.939)` ≈ `#055C8C`) is correct as-is. Fix the
> dark-mode value to match, don't treat the current oklch as the source of truth.

## Chart colors

Default to the blue theme (`--chart-*` tokens) **unless** the chart is showing a value that's one of
the seven categorical colors in `.claude/rules/web-color.md` (point outcomes, category legends,
anything that rule already assigns a specific hex to) — in that case use the categorical palette for
that value, not blue. Blue-by-default keeps charts visually calm when the data has no inherent
category; the categorical palette takes over only when the data actually has categories that rule
already speaks for.

## Font

**Inter** (`Inter Variable`, `--font-sans` in `app.css`). Already correct project-wide — nothing to
change, just don't introduce a second font.

## Icon library

**Lucide** (`components.json`'s `iconLibrary`). Already correct — don't hand-pick icons from another
set.

## Radius

**Always `rounded-sm`** (`0.6 × --radius` = `0.27rem`, ≈4px) — for every rectangular component:
buttons, inputs, cards, alerts, dialogs, tabs, toggles. One literal value everywhere, not a scale
picked per component. This replaces the large end of the radius scale (`rounded-2xl` through
`rounded-4xl`) that every generated component in `src/components/ui/` currently uses — see the
tracked follow-up issues for bringing already-shipped pages in line.

**Exception: fully circular elements stay `rounded-full`.** A `Switch`'s pill-shaped track and round
thumb, or a circular icon/avatar badge, are a distinct shape convention, not a point on the radius
scale — collapsing them to `rounded-sm` would break the control's recognizable shape, not just its
corner style. Anything that is not already a circle converges on `rounded-sm`; anything that's
deliberately a circle (or pill, for a track shape like `Switch`) stays that way.

## Menu

**`menuColor: default`, `menuAccent: subtle`** (`components.json`). Solid menu background, subtle
accent treatment for hover/active menu items — don't override per screen.
