---
paths:
  - apps/api/src/matchpoint_api/models/**
---

## Rows Are Archived, Never Deleted

- Player rows carry `archived_at` and are archived, not deleted. A player with matches recorded
  against them cannot be removed without taking the match history along, and analytics that compare
  a player across matches would lose the comparison. Don't add a hard-delete path; new tables that
  anything else references get the same treatment.

## Ids Are Client-Assignable UUIDs

- Primary keys are `uuid.UUID` with `default=uuid.uuid4`, never a serial. Capture happens offline,
  so the client assigns the id when the row is created and the row keeps that identity when it
  syncs. A server-assigned id would mean every offline row changing identity on arrival, and every
  reference to it needing rewriting.

## Enums Are VARCHAR + CHECK

- Declare enum columns with `str_enum(MyEnum, "constraint_name")` from `models/types.py` — never a
  native Postgres enum. Postgres cannot remove a value from a native enum, so adding one could never
  be rolled back and every enum migration would ship a downgrade that lies.
- The constraint name is the second argument and is what a migration must name later, so it is worth
  choosing deliberately: it has to read unambiguously in a revision that does not have the model in
  front of it, and it is not required to match the column name.
- A new enum must be re-exported from `models/__init__.py` and added to its `__all__`; the schemas
  import enums from the package, so it fails at import until then.

## Timestamps

- Every table carries `created_at` and `updated_at`, both `DateTime(timezone=True)` with
  `server_default=func.clock_timestamp()`, and `updated_at` also `onupdate=func.clock_timestamp()`.
- `clock_timestamp()`, not `now()`: in Postgres `now()` is the _transaction_ timestamp, so every row
  written in one transaction shares a value — silently voiding any ordering that uses the column as
  a tiebreaker, which is exactly what a batch of synced matches would hit.

## Foreign Keys Carry Their Index

- `ForeignKey(...)` and `index=True` go together. Postgres does not index a foreign key
  automatically, and every query that follows the relationship filters on it.
- Declaring no `ondelete` is deliberate: Postgres then refuses to delete a parent that still has
  children, rather than cascading into match history or orphaning rows.

## Length Bounds Live on the Schema

- Bounded free text is `String(100)` on the column, paired with `ShortText` on the schema. Prose is
  an unbounded `Text` column with `LongText` on the schema — the bound is the schema's alone, where
  it reaches the OpenAPI spec and so the client form.
