---
paths:
  - apps/web/src/features/capture/**
---

## Network-Free Zone

- This path performs **no network I/O** — no `fetch`, no API client, no `await` on anything crossing
  the wire. ESLint enforces the import side (see the `features/capture` block in
  `eslint.config.mjs`) and a violation fails CI, but the invariant is broader than lint can see.
- Instead: a tap handler updates local state and appends to the local outbox, synchronously. A
  separate sync layer drains it. Never make a tap wait on a promise — the brief requires a point in
  no more than three taps, and that has to hold with the device offline mid-match.
- Scoring logic lives here in TypeScript, not on the server, for the same reason: the score must
  update with zero connectivity.

## Built for a Real Phone

- The app is an installed PWA and **iOS cannot lock orientation** — capture screens must work in
  portrait _and_ landscape. A desktop browser window hides this; check both.
- No hover-only affordances — there is no hover on a touch screen.
- Touch targets should be thumb-reachable and hittable without looking; the user is watching the
  match, not the screen.
