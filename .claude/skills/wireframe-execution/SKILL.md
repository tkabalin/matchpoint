---
name: wireframe-execution
description:
  Turns a MatchPoint wireframe (Claude Design .dc.html or exported frames) into real React +
  shadcn/ui screens in apps/web. Use this whenever the user asks to "build," "implement," "wire up,"
  or "flesh out" a MatchPoint screen/page/tab from a wireframe, or references a wireframe frame
  number (e.g. "1d", "3b") and wants it turned into code. Always use this skill instead of
  hand-building UI when a wireframe file is attached or referenced — do not freehand component
  choices or styling when this skill applies.
---

# MatchPoint Wireframe Execution

Converts an already-designed MatchPoint wireframe into production React code, using only shadcn/ui
components with a single consistent set of defaults, wired into real (or realistically
placeholdered) data.

## Before starting

This skill depends on two files that are supplied at run time, not bundled with the skill. Do not
proceed without locating both:

1. **The wireframe** — the frame-by-frame design (Claude Design `.dc.html` export or equivalent)
   showing every page and its skeleton. Frame IDs look like `1a`, `2b`, `3b`, etc.
2. **The shadcn defaults doc** — the canonical prop/variant defaults every reused component must
   follow (e.g. `Button` default size/variant, `Card` padding, `Badge` variant per outcome type).

If either is missing from the conversation or the project, stop and ask the user to attach it rather
than guessing at design decisions or default props.

## Core rules

### 1. shadcn/ui components only — nothing hand-rolled

Every piece of UI must map to a shadcn/ui component (Base UI style per this project's
`tech-stack.md`, generated via CLI — never Radix, never a hand-written equivalent). Before writing
any screen:

- List every UI element the frame needs (buttons, cards, tabs, badges, tables, dialogs, etc.)
- Map each to the specific shadcn component + variant
- Confirm each is already generated in `apps/web/src/components/ui/`; if not, note it needs
  `pnpm dlx shadcn add <component>` rather than hand-rolling a substitute
- Only write custom code for layout/composition (flex/grid wrappers, page shells) — never for things
  shadcn already provides (no custom button, no custom modal, no custom tabs)

### 2. One set of defaults, everywhere

Read the attached shadcn defaults doc first and apply its prop values verbatim to every instance of
a reused component — same `variant`, `size`, `rounded`, spacing tokens, etc. Do not introduce a
one-off variant for a single screen unless the wireframe explicitly shows a different visual
treatment there. If a frame's rendering seems to imply a different default than the doc specifies,
the doc wins — flag the discrepancy to the user instead of silently picking one.

### 3. Follow the wireframe skeleton — decorate, don't redesign

The wireframe already fixes page structure, navigation, and skeleton layout. Your job is filling and
decorating with the right shadcn components, not re-deciding layout, spacing philosophy, or
information architecture. Keep the existing MatchPoint design-system values already in place
project-wide: light canvas `#f2f2f0`, white cards, brand blue `#045C8C` for nav/active states
(`#1E88C7` in dark mode — see `.claude/rules/web-color.md`), point-outcome colors reserved strictly
for point-outcome data — never for nav/brand chrome — pulled from the categorical palette in
`.claude/rules/web-color.md`: Jade green `#1FBF8C` (winner) / Burnt vermillion `#9C3D0A` (unforced
error) / Orange `#E69F00` (forced error). These are that file's current, luminance-audited values,
not the original Okabe-Ito hexes the wireframe mockup itself used — always defer to
`.claude/rules/web-color.md` as the source of truth if the two ever disagree again. Inter +
tabular-nums for stats.

**Skip these frames entirely — do not build or reference them:** 2a, 2b, 2d.

### 4. Data vs. navigation components

Most components on any screen fall into one of two buckets — handle each differently:

- **Navigation** (tabs, bottom nav, links, route transitions): must be fully functional. Wire real
  TanStack Router routes/links, not stubs. This is not optional or placeholder-able.
- **Data-bearing** (anything rendering player/match/stat data): check `apps/api/openapi.json` first.
  If the endpoint already exists (currently only OTP auth, coaches CRUD, players CRUD, matches
  CRUD-with-metadata), wire it for real through the generated API client and TanStack Query. If it
  doesn't exist yet (points/capture/stats/H2H/notes all currently don't), use the placeholder
  pattern below — do not block the wireframe build on missing backend work.

**Placeholder pattern for missing schema:**

- Provisional types live in the feature's own `types.provisional.ts` — shaped exactly like the
  eventual generated DTO would be, never `any`.
- Deterministic fixture data (not `faker.js`) in `mocks/fixtures/*.ts` — 3–5 realistic, stable named
  records per entity, covering empty/one/many states. Wireframes need visual consistency across
  reloads and reviews, not randomized data.
- Wrap fixtures in a TanStack Query hook with the exact signature the real generated hook will
  eventually have (e.g. `usePlayerOverview(playerId)` → `{data, isLoading, error}`), resolving from
  the fixture instead of fetching. Nothing in the component tree should need to change when the real
  endpoint lands — only the hook body swaps.
- Tag every placeholder hook with a `// PLACEHOLDER:` comment naming the missing endpoint, so it's
  greppable later.
- Keep placeholders out of `packages/api-client` (generated-only, never hand-edited) — they live in
  the feature slice's own `mocks/` folder.

### 5. Frame-specific behavior: 3b (and 3a)

The primary action button on 3b/3a is state-dependent, not a fixed icon:

- **A match is currently in progress:** show a **Play** button. Its only behavior is continuing that
  in-progress match — do not offer starting a new one while one is active.
- **No match in progress:** show a **+ (plus)** button, matching the treatment already shown on
  frame 3a, to start a new match.

This is a single component with two states driven by whether an in-progress match exists
(client-side `matches` state until the capture/points API exists — see placeholder pattern above),
not two separate buttons.

## Workflow

1. Confirm both the wireframe and the defaults doc are available; ask for whichever is missing.
2. Identify the target frame(s) from the user's request.
3. Skip immediately if the frame is 2a, 2b, or 2d.
4. Inventory the shadcn components the frame needs; confirm each is generated in
   `apps/web/src/components/ui/`.
5. Build the page/component, applying defaults-doc values to every component instance.
6. Wire navigation fully. For data: check `apps/api/openapi.json` for the endpoint; wire real data
   if present, placeholder pattern if not.
7. For 3a/3b specifically, implement the Play/+ state logic described above.
8. Before finishing, self-check against rules 1–2: did anything get hand-rolled instead of using
   shadcn, and does every component match the defaults doc?
