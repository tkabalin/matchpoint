---
paths:
  - apps/api/migrations/**
---

## Alembic

- `env.py` is generated from Alembic's **`generic`** (sync) template, not `async`. If it needs
  regenerating, use the generic template and re-apply the two local edits: the
  `config.set_main_option("sqlalchemy.url", settings.database_url)` line, and
  `target_metadata = Base.metadata`.
- The database URL is set in `env.py` from `settings`, deliberately not in `alembic.ini` — don't add
  a `sqlalchemy.url` there.

## Autogenerate Produces a Draft

- Read every generated revision before keeping it. It is reliable for added columns, type and width
  changes, and nullability; it is **wrong or silent** for the three that matter most — a renamed
  column comes out as drop-plus-add (data loss), a changed enum leaves its CHECK constraint stale
  because Alembic compares those by name and never by condition, and a changed server default
  produces nothing at all.
- Write these by hand, naming a CHECK constraint after `str_enum`'s second argument rather than the
  column. The `update-api-fields` skill walks the cases in full.

## `downgrade()` Must Really Reverse

- `tests/test_migrations.py` walks head to base a revision at a time and back up again, comparing
  the schema each downgrade steps back to against the one the matching upgrade builds from the same
  place. A downgrade that drops less than its upgrade added fails there, emptied bodies included.
- What the comparison cannot see is **data**: a downgrade restoring a column but not its contents
  passes, because it runs against an empty database. A revision whose upgrade is lossy says so in a
  comment, and the tests further down the file arrange rows for the ones where the loss is the
  point.

## Adding a Table

- Add its name to `MIGRATED_TABLES` in `tests/test_migrations.py`. That set is what the endpoints of
  the walk assert over, so a table left out is one nothing checks was built or dropped at all.
