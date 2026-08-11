---
paths:
  - packages/api-client/**
---

## Generated, Never Hand-Edited

- `packages/api-client/src` is **generated output**. FastAPI emits an OpenAPI 3.1 schema to
  `apps/api/openapi.json`, and `@hey-api/openapi-ts` turns that file into the typed client and
  TanStack Query options in this package.
- Never hand-edit anything under `src/`, and never patch a type to make a call site compile — the
  next regeneration silently discards it. Both halves are caught in CI — the API suite fails on a
  stale `openapi.json`, the `web-api-client` job fails on a `src/` the spec has outgrown — but a
  hand-edit is a bug regardless of what the pipeline says about it.
- If the client is wrong, the **API** is wrong. Fix the FastAPI route's response model, Pydantic
  schema, or status codes, then regenerate with `scripts/gen-api-client.sh`.
- If the generator's output itself needs to change (naming, plugins, formatting), change the
  generator config, not its output.

## The Hand-Written Files

- `openapi-ts.config.ts`, `runtime-config.ts`, `package.json`, and `tsconfig.json` are ours to edit.
  They sit outside `src/` precisely so the boundary is visible.
- `runtime-config.ts` supplies the client's base URL when the client is created. It is where an
  environment-dependent value belongs — the generated code stays environment-agnostic.
