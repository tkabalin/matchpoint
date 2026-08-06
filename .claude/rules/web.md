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

## Imports & Naming

- Use the `@/` alias (set in both `tsconfig.json` and `vite.config.ts`) for anything outside the
  current directory — `@/lib/utils`, not `../../../lib/utils`. Relative imports are fine for
  siblings.
- Filenames are lowercase, kebab-case (e.g. `test-setup.ts`, `button.tsx`) — no PascalCase, even for
  files exporting a single component. Matches the shadcn CLI's own output.
