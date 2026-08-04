---
paths:
  - packages/api-client/**
---

## Generated, Never Hand-Edited

- `packages/api-client` is **generated output**. FastAPI emits an OpenAPI 3.1 schema, and
  `@hey-api/openapi-ts` turns it into the typed client and query hooks in this package.
- Never hand-edit anything in here, and never patch a type to make a call site compile — the next
  regeneration silently discards it. Nothing currently verifies this automatically — a
  regenerate-and-diff CI job is intended, but until it lands the only guard is review, so treat a
  hand-edit here as a bug even though it will pass the pipeline.
- If the client is wrong, the **API** is wrong. Fix the FastAPI route's response model, Pydantic
  schema, or status codes, then regenerate.
- If the generator's output itself needs to change (naming, plugins, formatting), change the
  generator config, not its output.
