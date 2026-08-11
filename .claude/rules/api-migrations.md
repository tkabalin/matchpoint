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

- The round-trip test only fails on a downgrade that _raises_. One that is empty or incomplete still
  leaves the earlier revisions to drop the tables, so the suite stays green while the revision
  cannot actually be rolled back. Reviewing it is on you.

## Adding a Table

- Add its name to `MIGRATED_TABLES` in `tests/test_migrations.py`. The round-trip test asserts only
  over that set, so a table left out is a table the test silently says nothing about.
