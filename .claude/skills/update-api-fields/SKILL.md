---
name: update-api-fields
description:
  Add, change, rename, or remove a field on an API model in apps/api. Walks the whole path a field
  touches — column, Alembic migration, Pydantic schemas, router, and tests at the
  model/schema/router layers — plus the changes autogenerate cannot see. Use whenever a request
  implies a new or altered column or request/response field (e.g. "add notes to matches", "make
  opponent_name required", "add a surface option").
---

# Changing a field on an API model

A field is never one edit. The steps that get forgotten fail quietly rather than loudly:
autogenerate is blind to some changes, and a field missing from a schema is dropped from the
response with no error. Work the steps in order.

| #   | Where                                               | Skip when                            |
| --- | --------------------------------------------------- | ------------------------------------ |
| 1   | `src/matchpoint_api/models/<model>.py` — the column | never                                |
| 2   | `migrations/versions/` — the revision               | never                                |
| 3   | `src/matchpoint_api/schemas/<model>.py`             | field is server-owned (ids, stamps)  |
| 4   | `src/matchpoint_api/routers/<models>.py`            | router splats and never names fields |
| 5   | `tests/models/`, `tests/schemas/`, `tests/routers/` | never                                |
| 6   | `scripts/gen-api-client.sh` — spec + TS client      | never                                |

## 1. Decide before typing

- **Required or optional?** The bias is optional — player and match setup happens courtside and must
  stay fast. A new required field on an existing table also needs a backfill story (step 2).
- **Stored or derived?** The client owns scoring offline, so anything it can recompute is a sync
  conflict waiting to happen.
- **Pick the column type from the conventions**, not from scratch:

| Kind        | Column                                                             | Schema               |
| ----------- | ------------------------------------------------------------------ | -------------------- |
| Free text   | `String(100)`                                                      | `ShortText`          |
| Prose       | `Text` (unbounded; the limit is the schema's alone)                | `LongText`           |
| Enum        | `str_enum(MyEnum, "constraint_name")` (`models/types.py`)          | the `StrEnum` itself |
| Date        | `Date`                                                             | `date`               |
| Timestamp   | `DateTime(timezone=True)`, `server_default=func.clock_timestamp()` | usually read-only    |
| Foreign key | `ForeignKey("others.id")`, `index=True`                            | the raw `uuid.UUID`  |

`ShortText` and `LongText` (`schemas/types.py`) strip before measuring and set `min_length=1`, so
they reject `""` and whitespace-only. Both are **input** annotations — `XRead` uses plain `str`.
`ShortText`'s bound is paired with the `String(100)` columns: change one, change the other.

Postgres does not index a foreign key automatically, which is why `index=True` and the FK belong
together. Declaring no `ondelete` is deliberate: Postgres then refuses to delete a parent that still
has children, rather than cascading into match history or orphaning rows.

A **new enum** must also be re-exported from `models/__init__.py` and added to its `__all__` — the
schemas import enums from the package, so it fails at import until then.

Leave a comment on the column when there was a real decision behind it (nullability, why free text
and not a FK, why this default). Match the density already there.

## 2. The migration

**First, has the head revision ever run against a deployed database?** If not, fold the change into
the revision that creates the table rather than stacking a new one — note that is not necessarily
head; a `players` column belongs in the players revision. After folding, your own dev database is
still stamped at head, so `alembic upgrade head` no-ops and the app serves the old schema while
tests pass. Drop and recreate it.

```
cd apps/api
uv run alembic revision --autogenerate -m "add notes to matches"
```

Then **read the generated file**. It is a draft:

| Change you made            | What autogenerate produces                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| New column                 | `add_column` — correct                                                                                                                          |
| Type or width change       | `modify_type` — correct (`compare_type` is on by default)                                                                                       |
| Nullability change         | `modify_nullable` — correct                                                                                                                     |
| **Renamed column**         | **`remove_column` + `add_column` — silent data loss.** Replace by hand with `op.alter_column("matches", "event", new_column_name="tournament")` |
| **Changed enum members**   | **Nothing useful** — see below                                                                                                                  |
| **Changed server default** | **Nothing.** `compare_server_default` defaults to false and `env.py` does not enable it. Hand-write it                                          |

The enum case deserves detail, because the failure looks like success. Alembic compares named CHECK
constraints by name only, never by condition, so editing an enum's members leaves the constraint
stale: add a member no longer than the current longest and autogenerate reports **no changes at
all**; add a longer one and it emits a `modify_type` widening the VARCHAR, which looks like it
handled the enum while the CHECK still rejects the new value at runtime. Hand-write it, naming the
constraint after `str_enum`'s second argument (`match_format`, not `format`):

```python
def upgrade() -> None:
    op.drop_constraint("surface", "matches", type_="check")
    op.create_check_constraint(
        "surface", "matches", "surface IN ('hard', 'clay', 'grass', 'carpet', 'sand')"
    )
```

The **downgrade** is the dangerous direction: it narrows the constraint, so Postgres scans the table
and fails on any row already holding the new value (`23514 check_violation`). `UPDATE` those rows
first. The round-trip test runs against an empty database and will not catch it. Same when removing
a member for real.

Adding a **NOT NULL** column to a populated table: with a _constant_ `server_default` Postgres fills
it in without rewriting the table. A _volatile_ default rewrites the whole table and its indexes —
`clock_timestamp()` is exactly that, so a new timestamp column is not the cheap case. Without a
default, the three-step dance still applies: add nullable, backfill, then
`alter_column(nullable=False)` (which scans).

Always write a real `downgrade()`, and note what does **not** protect you here: the round-trip test
only fails on a downgrade that _raises_. An empty or incomplete one leaves the table drops in the
earlier revisions to clean up, so the tables still disappear and the suite stays green. Reviewing it
is on you.

## 3. Schemas

`XCreate` is input, `XRead` is output; keep them separate from the ORM model. Optional input fields
need an explicit default (`= None`) or Pydantic keeps them required.

`response_model` **filters the response to the declared fields**. Add a column and wire it through
the router but forget `XRead`, and the value is silently dropped on the way out — the same quiet
failure as step 4, on the path that is always live.

Adding a field to `XRead` changes the API contract; removing one breaks clients. If a new field
needs an existence check that raises a 404, declare it (`responses={404: ...}`) or the generated
client cannot type the error.

## 4. The router

Routers construct rows by splatting the validated schema:

```python
match = Match(**data.model_dump())
```

That picks up new fields automatically — which is safe precisely because `XCreate` carries only the
client-settable columns, so a server-owned field cannot be set from a request. Check the router
before assuming: if one names fields explicitly, add yours. Nothing errors if you forget — the
request returns 201 and the column stays NULL, and only a test that reads the row back catches it.

Renames reach further than construction: routers also name columns in `order_by` and `where`
clauses, and so do the factories and raw-SQL inserts in the tests.

## 5. Tests

**`tests/models/`** — what the database enforces, through **raw SQL**
(`db_session.execute(text(...))`), because a sync payload reaches the table without Pydantic or the
ORM's enum binding vetting it:

- Enum → the CHECK rejects a value outside the enum. **This is the only guard against enum drift** —
  neither autogenerate nor the drift test compares a CHECK condition. The invalid value must **fit
  the column**: `native_enum=False` sizes the VARCHAR to the longest value, so a longer bogus value
  fails on length first and proves nothing. `surface` is VARCHAR(6) — use `"sand"`, not
  `"astroturf"`.
- Free text → a value one over the column width is rejected (`DataError`).
- NOT NULL → omitting it raises `IntegrityError`.
- FK → an unknown id raises; deleting the parent while children exist raises.
- Indexed → assert via `inspect(db_session.connection()).get_indexes(...)`.
- Server default / `onupdate` → assert the value moves, and do it **through the ORM, not raw SQL**.
  `onupdate` is emitted by SQLAlchemy on a Core/ORM `UPDATE`; there is no database trigger, so a raw
  `UPDATE` never fires it. Class bodies execute on import, so these columns report full line
  coverage whether they work or not.

The existing raw inserts name their columns positionally — a new NOT NULL column on a table makes
those tests fail on a null violation instead of the constraint they exist to pin. Extend them.

**`tests/schemas/`** — pure validation, no database. Both sides of every boundary: at-limit accepted
_and_ over-limit rejected, blank and whitespace-only, enum coercion from a string, malformed input.
Parametrize over fields sharing an annotation.

**`tests/routers/`** — the field round-trips: present in the POST response, readable back from the
database (this is what catches step 4), and returned by the GET. One representative 422 per rule;
leave exhaustive cases to the schema tests.

`tests/factories.py` splats `**overrides` straight into the constructor, so a new column is settable
from a test with no factory edit. Extend it when the field is NOT NULL without a server default —
then every existing call site breaks until it has a default.

`MIGRATED_TABLES` in `tests/test_migrations.py` lists **tables**, not fields — touch it only when
adding a table.

## 6. Verify

The suite needs Postgres up (`docker compose up -d --wait` from the repo root).

```
cd apps/api && uv run pytest
```

`test_the_schema_at_head_matches_the_models` is the guard for step 2 — it fails whenever a column
reached a model without a revision to match. Coverage is informational here (there is no enforced
threshold), so a new branch needs a test because review expects one, not because a gate will stop
you.

Then regenerate the spec and the TypeScript client the web app compiles against, and commit both
with the change:

```
scripts/gen-api-client.sh
```

`test_the_committed_spec_matches_the_routes` catches a forgotten spec dump. Nothing catches a
forgotten client regeneration, so run the script rather than the dump alone.

## Checklist

- [ ] Column added, with a comment if there was a decision
- [ ] New enum re-exported from `models/__init__.py` and in `__all__`
- [ ] Migration: folded into the unshipped revision (and dev database recreated), or new
- [ ] Migration hand-reviewed — rename is `alter_column`; enum and server-default changes are
      hand-written
- [ ] `downgrade()` is real, and narrowing a CHECK handles existing rows
- [ ] `XCreate` and/or `XRead` updated; optional fields have `= None`
- [ ] Router constructs the field; `order_by`/`where` still name real columns
- [ ] Model test: constraint / default / index the field introduces
- [ ] Schema test: both sides of every boundary
- [ ] Router test: round-trips through POST and back out of GET
- [ ] `uv run pytest` green
- [ ] `scripts/gen-api-client.sh` run; regenerated spec and client committed with the change
