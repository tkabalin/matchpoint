---
paths:
  - apps/api/src/matchpoint_api/routers/**
  - apps/api/src/matchpoint_api/schemas/**
---

## `XCreate` Is Exactly the Client-Settable Columns

- A `Create` schema carries only the fields a client may set. That is what makes
  `Model(**data.model_dump())` safe in the router: a column absent from the schema cannot be set
  through it, so ownership and server-managed state stay out of reach.
- Server-owned fields — `coach_id`, the timestamps, `archived_at` — belong on `Read` and never on
  `Create`. Adding one to a `Create` schema turns the splat into mass assignment, quietly.
- `Read` schemas set `model_config = ConfigDict(from_attributes=True)` and routes return the ORM
  object; `response_model` does the serialisation.

## Archived Rows Leave the List, Not the Lookup

- List endpoints exclude archived rows. Fetch-by-id does not — a stored link or a match referencing
  an archived player must still resolve, rather than breaking once someone is off the roster.

## Let Pydantic Raise the 422

- **Never raise a 422 by hand.** FastAPI auto-declares every route's 422 as `HTTPValidationError`,
  whose `detail` is a list of errors, and the generated TypeScript client unpacks it as one — so an
  `HTTPException(422, detail="...")` returns a shape the client cannot read.
- Validation that belongs to the shape of the data goes in a `field_validator` raising `ValueError`;
  FastAPI turns that into a correctly-shaped 422 on its own.
- For a body field referencing a row that doesn't exist, check it in the route and raise **404** —
  the project's choice, and a status FastAPI does not auto-declare. Checking it beats leaving it to
  the foreign key, which surfaces as a 500 from an `IntegrityError`.

## Auth Endpoints Answer Known and Unknown Addresses Alike

- An endpoint taking an email from an unauthenticated caller must answer known and unknown addresses
  identically: status, body, and the 429/`Retry-After` a drained rate limit produces. The one
  exception is the sign-up entry point's 409, and it is not a precedent — the policy and its
  reasoning live in `docs/security.md`; argue there before adding a second exception.
- Timing is part of the promise on credential checks: login burns a dummy Argon2 verification for an
  unknown email rather than exiting early. Match that pattern before adding any auth path that
  hashes or queries conditionally.

## A Conflict on a Unique Column Is a Caught 409

- A value colliding with a `UNIQUE` constraint is a **409**, raised from a caught `IntegrityError`
  rather than a pre-check. This is the one place a pre-check is not enough: two requests can both
  pass it and one still raises, so the catch is needed anyway and the query only adds a round-trip.
  A foreign key has no such race, which is why the 404 above is pre-checked instead.
- `rollback()` first, then narrow on `isinstance(exc.orig, UniqueViolation)` and re-raise anything
  else. Reporting an unrelated integrity failure as a conflict points whoever hit it at the wrong
  cause.

## A Declared Response Declares a Model

- `responses={409: {"description": "..."}}` reaches the spec as a status with no schema, and the
  generated client types that as `unknown`. It unions a route's error responses into one type, so
  the `unknown` swallows the union whole and takes the auto-declared 422 with it — leaving the
  caller unable to read `detail` off either. Pass the model as well:
  `{"model": ErrorDetail, "description": ...}`, using `schemas/errors.py`.
- So a status is declared with a model or not declared at all. Declaring one exists to let the
  client branch on it, which is exactly what the missing model takes away.
- Nothing catches this: the spec test only checks that the committed `openapi.json` matches the
  routes, and it does — `unknown` is what the routes asked for.

## Validation JSON Schema Cannot Express Needs a Twin

- Rules like the date-of-birth and played-on bounds exist only in Python, so the OpenAPI spec cannot
  carry them and the generated client will happily send a value the server rejects. Note it on the
  validator, and the form gets its own check.

## No `db.refresh()` After `commit()`

- The session is built with `expire_on_commit=False`, so attributes are still loaded after a commit.
  A refresh is a wasted round-trip that reads back exactly what is already in memory.
