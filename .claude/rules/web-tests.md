---
paths:
  - apps/web/**/*.test.ts
  - apps/web/**/*.test.tsx
  - apps/web/e2e/**
  - apps/web/playwright.config.ts
  - apps/web/src/test-setup.ts
---

## Two Runners, Kept Apart

- Vitest runs unit/integration tests: `src/**/*.test.{ts,tsx}`, jsdom, Testing Library.
- Playwright runs browser e2e: `e2e/*.spec.ts`, plus `e2e/*.setup.ts` for the projects other
  projects depend on. Never name a Vitest file `.spec.ts` or put a Playwright spec under `src/` —
  the include patterns are what keep each runner off the other's files.

## Unit & Integration Tests (Vitest)

- Default to an integration test unless the code under test is pure logic with no DOM/network — see
  `docs/testing.md` for the full unit/integration/e2e split.
- Always co-locate the test next to its source (`state.test.ts` beside `state.ts`) — no `__tests__/`
  folder, even as a slice grows.
- Query by accessible role and name (`getByRole("button", { name: "Save" })`), not test IDs or CSS
  selectors; reach for `data-testid` only when no accessible query can work.
- Simulate interaction with `@testing-library/user-event`, not `fireEvent`.
- Assert on what the user sees, not on internal state or implementation details — a
  behaviour-preserving refactor should not break an integration test.

## E2E Tests (Playwright)

- Reserve e2e for critical whole journeys (e.g. the live capture flow); most behaviour belongs in an
  integration test instead.
- Use web-first assertions (`await expect(locator).toBeVisible()`) — never `waitForTimeout` or fixed
  sleeps.
- The Playwright config starts the Vite dev server **and the API** itself (`webServer`); don't add
  server bootstrapping to specs.
- Specs run against that live API. Reach for `page.route` only for a failure a healthy backend can't
  be asked to produce, and make the mocked body match the OpenAPI spec: FastAPI's 422 `detail` is an
  array of objects, not a string. See `docs/testing.md § A live API by default`.
- A spec that needs a signed-in coach adopts the session `auth.setup.ts` saved
  (`test.use({ storageState: COACH_STORAGE_STATE })`) rather than signing one up of its own. The
  exception is a spec that ends the session it runs as, or spends a per-account budget: that one
  signs its own coach up through `signUpCoach` (`e2e/api.ts`) from a blank storage state, since the
  shared session is one token every other context in the run replays.
- Helpers for talking to the API live in `e2e/api.ts` and for driving capture in `e2e/capture.ts`.
  Add to those rather than copying a helper into a second spec file.
- `test.fail()` is for pinning a defect that has an issue, and the reason argument names it. It is
  never a way to park a flaky or unfinished spec, and such a spec must assert on a signal the fix
  does not move — see `docs/testing.md § Pinning a known defect`.
- **A spec reporting `Expected to fail, but passed` means the defect it pins has been fixed.** The
  entire correct response is to delete that spec's `test.fail(...)` call. Never skip, delete or
  rewrite the spec, weaken its assertions, or widen its timeouts to clear the message — those
  assertions are what verify the fix, and this is the one moment they matter.

## API Contract Checks

Every function that builds a request body for the API needs two checks, both generated from the
OpenAPI spec so they cannot drift (see `docs/testing.md § Contract checks against the API`):

1. **Typed return.** Annotate the builder with the generated type from `@matchpoint/api-client`. A
   renamed or removed field then fails `tsc`, not a live request.
2. **Zod parse in the test.** Import the matching schema from `@matchpoint/api-client/zod` and
   `safeParse` the built body. This catches what the compiler cannot: wrong date formats, invalid
   UUIDs, over-length strings.

Inline bodies passed directly to a generated client function (e.g.
`login({ body: { email, password } })`) already get check 1 from the function's signature. They
still need check 2 in their test. Never hand-write a mock of the API shape.

See `docs/testing.md` for the unit/integration/e2e split and framework rationale.
