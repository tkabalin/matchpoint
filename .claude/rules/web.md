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

## Feature Slices

- `src/` is sliced by **feature**, not file type, so rules can be scoped to a directory. A feature's
  components, state, and helpers live together under `src/features/<feature>/`.
- **No cross-imports between feature slices.** If `features/matches` needs something from
  `features/players`, it belongs in `src/components/` or `src/lib/` — and only once there are two
  real call sites (see Code Style in `CLAUDE.md`).

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
