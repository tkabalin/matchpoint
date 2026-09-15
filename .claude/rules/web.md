---
paths:
  - apps/web/**
---

## Styling — Tailwind v4

- Tailwind is **v4**, configured CSS-first in `apps/web/src/app.css` via `@theme`. There is no
  `tailwind.config.js` and there should never be one — if you or an agent generates one, that's a v3
  answer to a v4 question; delete it and put the values in `@theme` instead.
- New tokens (colours, spacing, fonts) go in `@theme` and are used via the generated utilities.
  Don't hardcode hex values in `className`.

## The hover cursor is a base rule, not a per-component class

- `app.css`'s `button:not(:disabled) { cursor: pointer }` covers every button in the app, including
  the bare ones a feature builds itself and the ones Base UI renders inside `Toggle`, `Tabs` and
  `SelectTrigger`. Don't add `cursor-pointer` to a new button or to a `components/ui/` base class:
  it's already there, and a per-component copy is what let this drift in the first place (only
  `Button` had it, so roughly thirty other buttons showed the arrow).
- A component that genuinely wants a different cursor still says so with a utility, which wins over
  the base layer: `disabled:cursor-not-allowed`, `SelectItem`'s `cursor-default` (a select option
  follows the native menu convention, not the trigger's).

## The page itself must never scroll horizontally

- Only a component's own explicitly-built strip (`overflow-x-auto` on a specific, narrow container —
  `match-card.tsx`'s momentum timeline, `home.tsx:259`'s horizontal card row) may ever scroll
  sideways. The page around it always scrolls vertically only. `app.css`'s
  `html, body { overflow-x: hidden }` is the backstop, not the fix — anything that actually
  overflows still looks broken (clipped) even with that rule in place, it just stops the whole page
  from scrolling.
- **A single missing `min-w-0` breaks this, and only on mobile WebKit.** A flex item that's supposed
  to shrink below its content's natural width needs `min-w-0` at _every_ flex layer between the
  viewport and the actual `overflow-x-auto` container, not just on the container itself. Desktop
  Chromium/Firefox apply CSS's "automatic minimum size → 0 inside `overflow: auto`" rule leniently
  enough to paper over a missing `min-w-0` a few layers up; iOS Safari (and Chrome-for-iOS, also
  WebKit) does not, reliably, especially through `Item`'s (`components/ui/item.tsx`) flex-row base
  class wrapping a single full-width flex-column child — an unusual shape for `Item`, which normally
  holds multiple side-by-side children. This is exactly the shape that broke once for real
  (`match-card.tsx`) and reads as an intermittent, hard-to-reproduce-on-desktop layout bug rather
  than an obvious one: check this specifically before shipping a new `Item`-based row with a single
  wide child, and test on a real phone (or real mobile WebKit devtools emulation, not just a resized
  desktop window) before calling a horizontal-scroll fix done.
- **A grid needs an explicit column track too, not just `min-w-0` inside flex rows.**
  `AuthenticatedLayout` (`components/authenticated-layout.tsx`) wraps every authenticated screen in
  a CSS grid (`grid-rows-[auto_1fr]`, for the sticky header plus the routed page) but, until this
  was found, declared no `grid-cols-*` at all. A grid with no column track defaults its one implicit
  column to a bare `auto` track, which — unlike Tailwind's `grid-cols-*` utilities, which always
  wrap their tracks in `minmax(0, 1fr)` specifically to prevent this — sizes itself off a
  descendant's max-content or explicit `max-width` (here, `AppPage`'s own `max-w-md`, 448px) rather
  than the viewport. This is the CSS Grid "blowout" bug, the grid-layout sibling of the flex
  `min-w-0` trap above: it clipped Home and Matches specifically (a long player or opponent name was
  enough to trigger it) while Players and Squad stats, whose content never got that wide, looked
  fine — no flex-chain `min-w-0` fix anywhere lower in the tree would have touched this, since the
  point of failure was the grid container itself, several layers above `AppPage`. Fixed with
  `grid-cols-1`. Any future top-level CSS grid in this app needs an explicit `grid-cols-*` for the
  same reason a flex row needs `min-w-0` on its items: measure with `e2e/overflow.ts`'s
  `overflowingNodes()` helper (`e2e/layout-overflow.spec.ts` is the permanent regression guard)
  rather than assuming a grid with only rows declared is safe.
- **This also explains an oddly-behaving fixed bottom nav.** `BottomNav` itself
  (`components/bottom-nav.tsx`) is a correctly-built `fixed inset-x-0 bottom-0`, but nothing between
  it and the real viewport clips an overflowing descendant elsewhere on the page (no ancestor sets
  `overflow-x: hidden` short of the new global backstop above). An overflowing card bleeds past its
  own bounds all the way to the true viewport edge, which is exactly the condition that expands
  mobile Safari/Chrome's layout viewport and detaches a `position: fixed` element from the visual
  viewport it's supposed to track — so a horizontal-overflow bug elsewhere on the page can look like
  a bottom-nav bug with no connection to it at all. Fix the overflow at its source; don't go looking
  in `bottom-nav.tsx` first.

## Dark mode — toggle-only, never OS-detected

- Light/dark is decided **solely** by the coach's own choice in Settings > App > Appearance,
  persisted and resolved by `src/lib/theme.ts` (`useTheme`/`applyTheme`). Never call
  `matchMedia("(prefers-color-scheme: dark)")`, and never read `prefers-color-scheme` from CSS, to
  decide the app's own light/dark state — not even as a first-run default. This was tried once (an
  OS-preference read as the initial default, with the toggle only overriding it) and reverted: two
  independent OS-preference reads existed briefly (the `index.html` bootstrap script and a
  since-deleted `usePrefersDark` hook the logo used) and drifted out of sync under PWA caching,
  which is what originally made the logo and the rest of the UI disagree on theme (#200).
- Any component that needs to know the resolved theme (e.g. to pick between two whole image assets,
  like `Logo` does) calls `useTheme()` from `src/lib/theme.ts` — never its own `matchMedia` query.
  One source of truth, no second read to drift out of sync with it.
- `index.html`'s inline bootstrap script (`.dark` on `<html>` before first paint) reads
  `localStorage` directly rather than importing `theme.ts` — it has to run before any module loads,
  so its own resolve logic is deliberately duplicated there. Keep the two in sync by hand if either
  changes.

## Feature Slices

- `src/` is sliced by **feature**, not file type, so rules can be scoped to a directory. A feature's
  components, state, and helpers live together under `src/features/<feature>/`.
- **No cross-imports between feature slices.** If `features/matches` needs something from
  `features/players`, it belongs in `src/components/` or `src/lib/` — and only once there are two
  real call sites (see Code Style in `CLAUDE.md`).
- **One named exception: `features/outbox/`.** `features/capture/` and `features/sync/` import it by
  design: capture appends to the local queue, sync drains it, and the two may not import each other
  (see `web-capture.md`). `features/matches/` also imports it — deleting a match has to clear that
  match's own queued rows (`removeByMatch`), or a later drain re-posts them and puts the match back
  (#214). `features/players/` imports it for the same reason one level up: deleting a player erases
  their matches server-side too, so `edit-player-sheet.tsx`'s delete has to clear every one of that
  player's own logged matches and queued rows, or a still-open one pins the in-progress banner on a
  player id nothing can resolve again. It stays a slice rather than moving to `src/lib/` because it
  owns a database schema and its own durability rules, not a helper. This is not a precedent —
  anything else two slices share still goes in `src/components/` or `src/lib/`.
- **`features/capture/` is imported by whoever launches or reads a match.** `features/sync/` imports
  its `Match` and `Point` to build payloads, and `features/matches/new-match.tsx` imports
  `LiveMatch` because capture cannot fetch the player and coach it needs itself — the API client is
  banned inside that slice, so something outside it has to hand them in. Capture imports nothing
  back, which is what keeps this one-way and safe.
- `src/lib/local-data.ts` imports it too, the one place a `lib/` module depends on a slice. Deleting
  what the device holds for a coach spans the outbox and the persisted query cache, so it belongs to
  neither, and the keep-or-delete rules of a sign-out, a coach switch and a revoked session are only
  checkable while they sit in one file.

## HTML Injection

- Avoid `dangerouslySetInnerHTML` on data that isn't fully trusted (coach notes, player names, any
  other user-entered or stored text). React escapes text content by default — rendering it as plain
  text instead of markup is what prevents HTML/script injection from that data.

## API Client, Not `fetch`

- Never call `fetch` directly in feature code. Use the generated client from
  `@matchpoint/api-client` (for mutations/auth) or `@matchpoint/api-client/react-query` (for
  queries). ESLint enforces this in `features/`; the rule exists because the generated client
  handles error typing, auth cookies, and the base URL.
- **Reads** (data fetching for display) go through `@matchpoint/api-client/react-query`: import the
  `*Options` factory and pass it to `useQuery` or `useSuspenseQuery`. This gets caching,
  loading/error states, and offline persistence for free.
- **Writes** (mutations, auth actions) use the bare functions from `@matchpoint/api-client`, called
  directly or via `useMutation`.

## Dates from the API Are Calendar Dates

- The API sends date fields (`played_on`, `date_of_birth`) as `"YYYY-MM-DD"` strings.
  `new Date("2026-08-15")` parses that as UTC midnight, which in timezones east of UTC (including
  SAST) becomes the previous local day. Never pass a date-only string to the `Date` constructor. Use
  the multi-argument form: split into parts and call `new Date(year, month - 1, day)`, which always
  creates local midnight. See `home.tsx` and `match-payload.ts` for the existing pattern.

## Tests

- New behaviour ships with tests. Unit/integration tests are co-located `*.test.ts(x)` files run by
  Vitest; browser e2e lives in `e2e/` on Playwright. Conventions: `.claude/rules/web-tests.md`;
  framework: `docs/testing.md`.

## Imports & Naming

- Use the `@/` alias (set in both `tsconfig.json` and `vite.config.ts`) for anything outside the
  current directory — `@/lib/utils`, not `../../../lib/utils`. Relative imports are fine for
  siblings.
- Filenames are lowercase, kebab-case (e.g. `test-setup.ts`, `button.tsx`) — no PascalCase, even for
  files exporting a single component. Matches the shadcn CLI's own output.
