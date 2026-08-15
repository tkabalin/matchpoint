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
- Playwright runs browser e2e: `e2e/*.spec.ts` only. Never name a Vitest file `.spec.ts` or put a
  Playwright spec under `src/` — the include patterns are what keep each runner off the other's
  files.

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
- The Playwright config starts the dev server itself (`webServer`); don't add server bootstrapping
  to specs.

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
