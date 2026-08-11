---
paths:
  - packages/api-client/**
---

## Generated, Never Hand-Edited

- `packages/api-client/src` is **generated output**. FastAPI emits an OpenAPI 3.1 schema to
  `apps/api/openapi.json`, and `@hey-api/openapi-ts` turns that file into the typed client and
  TanStack Query options in this package.
- Never hand-edit anything under `src/`, and never patch a type to make a call site compile — the
  next regeneration silently discards it. The API suite fails on a stale `openapi.json`, but nothing
  yet checks that `src/` matches the spec, so an unregenerated client passes the pipeline. Treat a
  hand-edit here as a bug regardless.
- If the client is wrong, the **API** is wrong. Fix the FastAPI route's response model, Pydantic
  schema, or status codes, then regenerate with `scripts/gen-api-client.sh`.
- If the generator's output itself needs to change (naming, plugins, formatting), change the
  generator config, not its output.

## The Hand-Written Files

- `openapi-ts.config.ts`, `runtime-config.ts`, `package.json`, and `tsconfig.json` are ours to edit.
  They sit outside `src/` precisely so the boundary is visible.
- `runtime-config.ts` supplies the client's base URL when the client is created. It is where an
  environment-dependent value belongs — the generated code stays environment-agnostic.
