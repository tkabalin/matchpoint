---
paths:
  - apps/api/src/matchpoint_api/models/**
---

## Rows Are Deleted, Never Flagged

- No table carries a deleted-but-kept flag, and a new one must not introduce the idea: a coach who
  asks to be rid of a row means it, and a flag would leave the data sitting where nothing can reach
  it. `DELETE /players/{id}` erases the player and their matches; `DELETE /coaches/me` erases the
  coach and every row below them; a match entered by mistake deletes on its own, points and all.
  `deleted_matches` is not a counter-example: the match is genuinely gone, and the row holds only
  its id and the deleting coach, long enough that a create or a point flush queued offline before
  the delete is refused instead of landing. A window like that measures how long a client may sit on
  unsent rows, never how long a server-side lease runs, and expires lazily: an aged row stops
  matching and nothing sweeps it.
- **A route that deletes a parent deletes each child table in turn itself**, in the request's one
  transaction, so a **new table hanging off `matches`, `players` or `coaches`, or off anything
  already below them, extends that route's delete list**. The foreign keys declare no `ondelete`, so
  one left out makes the delete fail rather than orphan rows. Nothing else catches it; a route test
  that deletes with the new table populated does. `match_sets` is the single exception and not a
  precedent: it holds a tally the server derives from a match's points, so it cascades with the
  match instead of appearing in any delete list. `DELETE /matches/{id}` is in the same position, and
  deletes the match's points itself rather than refusing over them (`docs/data-model.md` records
  why).
- A delete is refused where the row is not this coach's alone to destroy: a live transfer code is
  another coach's pending claim, so it answers 409 on the player delete and on account closure
  alike. Refusals like that belong on **every** route that reaches the row, or the first one left
  out is the way around it.

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
  `deleted_matches` is the one exception, its single `deleted_at` being the moment the row exists to
  record; a table whose timestamp is not the row's own creation says so the same way.
- `clock_timestamp()`, not `now()`: in Postgres `now()` is the _transaction_ timestamp, so every row
  written in one transaction shares a value — silently voiding any ordering that uses the column as
  a tiebreaker, which is exactly what a batch of synced matches would hit.

## Foreign Keys Carry Their Index

- `ForeignKey(...)` and `index=True` go together. Postgres does not index a foreign key
  automatically, and every query that follows the relationship filters on it. The exception is a key
  that already leads a unique constraint's index (`player_transfer_codes.player_id`,
  `match_sets.match_id`), where a second index would only duplicate the first.
- Declaring no `ondelete` is deliberate: Postgres then refuses to delete a parent that still has
  children, rather than cascading into match history or orphaning rows. `match_sets` is the single
  exception, for the reason above.

## Length Bounds Live on the Schema

- Bounded free text is `String(100)` on the column, paired with `ShortText` on the schema. Prose is
  an unbounded `Text` column with `LongText` on the schema — the bound is the schema's alone, where
  it reaches the OpenAPI spec and so the client form.
