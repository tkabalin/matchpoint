---
paths:
  - apps/api/src/matchpoint_api/models/**
  - apps/api/migrations/**
---

## Keep the ERD in Step With the Schema

- `docs/data-model.md` carries a Mermaid ERD of every table, and the conventions the schema follows
  as a whole. A change to the files in these paths that alters the shape of the database updates it
  **in the same commit**: a new or dropped table, a column added, removed or renamed, a change of
  type, width, nullability or enum members, or a foreign key gained or lost.
- Nothing checks this — unlike `openapi.json`, the diagram is prose, so no test or CI job can tell
  it has gone stale. A wrong ERD is worse than none, because it is read instead of the migrations.
- Only the diagram is per-table. The **Conventions** section states the rules every table follows
  (UUID keys, `clock_timestamp()` defaults, VARCHAR-plus-CHECK enums, indexed foreign keys with no
  `ondelete`, where deletion is soft) — so it changes when a table _departs_ from one of them, or
  when a new decision applies across the schema, not on a routine column.
- The migrations remain the authority on the schema; the diagram is a map of them. Where the two
  disagree the migrations are right and the diagram is the bug.
