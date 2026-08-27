# Offline Sync

How captured data gets from the device to the server and stays consistent along the way. The
libraries chosen for each piece are documented in `docs/tech-stack.md`; the schema lives in
`docs/data-model.md`; the test strategy lives in `docs/testing.md`. This page covers the mechanism
those three describe the parts of.

## Two databases, one rule

The device holds two IndexedDB databases, deliberately separate:

- **The outbox** (`matchpoint-outbox`, Dexie) holds points and matches the server has never seen,
  plus the match log described below.
- **The read cache** (`matchpoint-query-cache`, idb-keyval) holds the last snapshot of the coach's
  roster and match lists, restored at startup so the app renders without a connection.

The rule: clearing or evicting the read cache must never reach the outbox. The cache is disposable,
refilled from the server on the next online visit. A queued point cannot be refilled from anywhere.

### The match log, beside the queue

The outbox database holds two more tables (`events`, `matches`), written by `match-log.ts`. They are
in the same database so a sign-out's `deleteOutboxDatabase()` takes them with it, but they answer a
different question and are deliberately not merged with the queue:

- The **outbox** is a message queue. Rows are immutable, first-write-wins by id, and a row is
  deleted once the server has it.
- The **log** is state: every event of every match still on this device. Rewriting an event under
  its own id overwrites, undo deletes one, and nothing is removed when a row syncs.

Capture writes both on every commit. Without the log, a match whose points had already drained would
lose its score on the next reload, since the queue rows it was folded from would be gone — so the
log is what "reopen at the same score" is built on, and what `undo` pops from.

## Outbox

A tap handler calls `append(entry)`, which writes to the outbox inside a Dexie transaction and
returns without blocking the UI. The entry carries the entity's client-generated UUID, its
serialised payload, the coach and match it belongs to, and a schema version stamped at write time so
a drain can tell which app version produced it.

**First-write-wins.** If the id is already in the queue, `append` returns the existing row's
sequence number and leaves it untouched, failed rows included. A queued payload is never rewritten,
because the drain acknowledges by id: rewriting one between its send and its acknowledgement would
have `remove` delete a payload the server never saw.

Rows are either `pending` or `failed`. Failed rows are skipped by `readPending` so one rejected row
does not stall everything behind it. `retryFailed` returns them all to `pending` and clears the
recorded reason.

On the first append, the outbox asks the browser for persistent storage
(`navigator.storage.persist`) so the origin is exempt from eviction. The request is fire-and-forget:
a point must not wait on it, and an unpersisted write is still a written point.

## Capture claim

A match being captured live is single-writer. Before capture begins, the device posts its id to
`POST /matches/{id}/capture`, which sets `capture_claim_device_id` and `capture_claim_expires_at` on
the match row (under a `FOR UPDATE` lock to prevent two devices winning). A second device is refused
while a live claim stands.

The claim expires after four hours (`CAPTURE_CLAIM_TTL`). That is deliberately longer than any
plausible match, because a device capturing offline cannot renew, and forcing a manual release after
every match would be worse than a long TTL. Any device of the same coach can release the claim
early; the holder's own ingest flushes renew it automatically.

Finishing the match (recording a `result`) clears the claim. Deleting a match while another device
holds it is refused; the holder is exempt, since backing out of capture does not release its claim.

## Drain engine

`drainOutbox(coachId, deviceId)` is the single entry point. It takes a Web Lock
(`navigator.locks.request` with `ifAvailable: true`) so two tabs never double-flush; a tab that
finds the lock held re-arms the trigger instead of waiting.

A drain sweep reads the pending queue, groups rows by match in first-seen order, and for each match
sends the match create (if queued) followed by its points in batches. Batches are bounded by both a
count ceiling (500 points, the spec's `maxItems`) and a byte budget (950 KB, under the API's 1 MB
body limit), whichever is reached first.

### Server-side idempotency

Both endpoints the drain calls are idempotent:

- `POST /matches` uses Postgres `ON CONFLICT DO UPDATE` (a no-op SET that takes the row lock and
  returns the existing row), so two retries of the same offline match cannot both insert.
- `POST /matches/{id}/points` uses `ON CONFLICT DO NOTHING` on the point's client-assigned id, so a
  retried or overlapping flush converges instead of failing. A point, once ingested, is immutable.

After each point batch, `recompute_match_sets` derives the match's set scores from a `GROUP BY` over
all its stored points, so a late, partial, or retried flush lands on the same answer.

### Response classification

Every server response falls into one of five buckets:

| Response                | Action                                | Rationale                                                 |
| ----------------------- | ------------------------------------- | --------------------------------------------------------- |
| 2xx                     | Remove rows from the queue            | Acknowledged                                              |
| 401                     | Halt the run, keep the queue intact   | A revoked session must never cost a match                 |
| 410                     | Discard the rows unsent               | The match was deliberately deleted; no failed count shown |
| Other 4xx (incl. 404)   | Park rows as `failed` with the reason | A permanent refusal no retry will clear                   |
| 5xx, 429, network error | Retry on a doubling backoff           | Transient; a 429's `Retry-After` overrides the schedule   |

The backoff schedule is `[1s, 2s, 4s, 8s]`. When the schedule runs out, the sweep ends and the next
flush trigger starts a fresh attempt.

A parked match fences off its points: the drain skips any match whose rows include a failed one,
since the server rejected the match itself and its points cannot land without it. Points appended
after the park arrive as `pending` and are caught by the same check on the next sweep.

## Flush triggers

iOS installed PWAs have no Background Sync API, so nothing flushes unless the foregrounded app is
told to. Four triggers feed one debounced schedule (1 s):

1. **App launch** — whatever survived the last visit goes out.
2. **Connectivity returns** — the `online` window event.
3. **Tab becomes visible** — `visibilitychange`.
4. **Queue write while online** — a Dexie `liveQuery` over the entry count, gated on
   `navigator.onLine` so offline captures do not burn the backoff schedule.

All four funnel into a single `scheduleDrain()`. The debounce coalesces a burst; the Web Lock makes
overlap harmless.

If an append fails with `DatabaseClosedError` (another tab upgrading the schema aborts this tab's
connection), a retry chain re-appends the entry at `[200ms, 1s, 5s]`. The close is self-healing: the
connection reopens on the next operation.

## Data ownership and sign-out

A `localStorage` key (`matchpoint:local-data-owner`) records which coach the device's data belongs
to. The sync layer reads it per drain, so a sign-in that lands after registration still finds the
right coach.

- **Session revoked (401):** cached reads are cleared; the outbox is kept, because the points are
  still the same coach's.
- **Explicit sign-out or coach switch:** both databases are deleted, since the outbox holds data the
  new coach must not see and has no way to sync.

A sign-in that records a different coach purges first. An absent record is treated as a stranger's
data, not as unclaimed.
