---
paths:
  - apps/api/src/matchpoint_api/routers/**
  - apps/api/src/matchpoint_api/schemas/**
  - apps/api/src/matchpoint_api/main.py
  - apps/api/src/matchpoint_api/__init__.py
---

## Regenerate the Client With the Change

- The files in these paths decide what the OpenAPI spec says, and the web app compiles against a
  TypeScript client generated from it. After changing any of them, run `scripts/gen-api-client.sh`
  and commit the regenerated `apps/api/openapi.json` and `packages/api-client/src` **in the same
  commit** as the change that caused them. It is idempotent, so running it when nothing moved costs
  a second and produces no diff.
- What reaches the spec: routes (path, method, status code, `response_model`, parameters, tags),
  schema fields and any constraint JSON Schema can express, enum members, docstrings and
  `Field(description=...)`, the package `__version__`, and **handler names** — which become both the
  operation id and the client's function name, so they must stay unique across routers.
- What does not: columns that no schema exposes, validation only Python can express, router body
  logic, and comments that aren't docstrings.

- Forgetting is caught, but late and in halves: `tests/test_openapi.py` fails on a spec the routes
  have outgrown, and the `web-api-client` CI job fails on a client the spec has outgrown. Running
  the script is cheaper than reading either failure.
