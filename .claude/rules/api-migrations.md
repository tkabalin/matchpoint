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
