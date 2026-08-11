# Data Model

The database schema, and the conventions every table in it follows. The Alembic revisions in
`apps/api/migrations/versions/` are the authority on the schema; this page is the map, so a revision
that changes the shape should update the diagram with it.

## Entity relationship diagram

The diagram below is Mermaid source. GitLab renders it as a diagram in the file view and in merge
requests; in an editor that doesn't, paste the block into an online Mermaid viewer.

```mermaid
erDiagram
    coaches |o--o{ players : owns
    players ||--o{ matches : plays

    coaches {
        uuid id PK
        varchar(254) email UK "the sign-in identity, stored lowercased"
        varchar(100) display_name "full name, or whatever they go by"
        text password_hash "argon2id hash"
        timestamptz created_at
        timestamptz updated_at
    }

    players {
        uuid id PK
        varchar(100) first_name
        varchar(100) last_name
        date date_of_birth "nullable"
        varchar(5) dominant_hand "nullable: right, left"
        varchar(6) gender "nullable: male, female, other"
        text notes "nullable: coach notes"
        uuid coach_id FK "nullable: the owning coach"
        timestamptz archived_at "nullable: soft delete"
        timestamptz created_at
        timestamptz updated_at
    }

    matches {
        uuid id PK
        uuid player_id FK "the coach's tracked player"
        varchar(100) opponent_name "nullable: free text, not a player"
        date played_on
        varchar(6) surface "nullable: hard, clay, grass, carpet"
        varchar(100) event "nullable: tournament or fixture"
        varchar(9) sets_format "nullable: best_of_1, best_of_3, best_of_5"
        timestamptz created_at
        timestamptz updated_at
    }
```

A match carries metadata only. Point-level data — serves, rally outcomes, rally length — is captured
against a match rather than stored on it, and is modelled separately.

## Conventions

**UUID primary keys, not serials.** Capture happens offline, so a row is created on the client and
reaches the server later; it needs an identity it can be given before any server sees it. That also
keeps rows unenumerable, which matters for a table like `coaches` where an id is the only thing
guarding a record.

**Timestamps default to `clock_timestamp()`, not `now()`.** In Postgres `now()` is the _transaction_
timestamp, so a batch of rows synced in one transaction would share a creation time — voiding any
ordering that uses `created_at` to break a tie. Every table carries `created_at` and `updated_at`,
both `timestamptz`.

**Enums are VARCHAR with a named CHECK constraint**, not native Postgres enums (`str_enum` in
`models/types.py`). Postgres cannot remove a value from a native enum, so a migration adding one
could not honestly be rolled back. The column is sized to the longest permitted value, which is why
the widths above look arbitrary.

**Foreign keys are indexed explicitly and declare no `ondelete`.** Postgres does not index a foreign
key automatically. Leaving off `ondelete` means a delete that would orphan rows is refused outright
rather than cascading through a roster and the match history hanging off it.

**Optional unless the value is genuinely required.** Player and match setup happens courtside and
has to be fast, so beyond the fields that identify a row there is little a coach must fill in.
`coaches` is the exception — every column is NOT NULL, because all of them are collected at sign-up
and a row missing any of them is not an account.

**Deletion is soft where history depends on it.** A player with matches recorded against them cannot
be removed without taking that history along, so `archived_at` takes them off the active roster
while leaving them readable by id.
