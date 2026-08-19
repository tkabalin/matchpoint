---
paths:
  - apps/api/src/matchpoint_api/routers/**
  - apps/api/src/matchpoint_api/schemas/**
---

## `XCreate` Is Exactly the Client-Settable Columns

- A `Create` schema carries only the fields a client may set. That is what makes
  `Model(**data.model_dump())` safe in the router: a column absent from the schema cannot be set
  through it, so ownership and server-managed state stay out of reach.
- Every request-body schema subclasses `RequestModel` (`schemas/types.py`), whose `extra="forbid"`
  answers an unknown key with a 422. The client is generated from this API's own spec, so a key we
  don't recognise is a caller bug, and ignoring it makes a misspelled field look like success.
  `tests/test_openapi.py` fails on a body schema that skipped the base, since nothing else would: it
  produces a valid spec and a 200 that wrote nothing.
- Server-owned fields, `coach_id` and the timestamps, belong on `Read` and never on `Create`. Adding
  one to a `Create` schema turns the splat into mass assignment, quietly.
- `Read` schemas set `model_config = ConfigDict(from_attributes=True)` and routes return the ORM
  object; `response_model` does the serialisation.

## `XUpdate` Is Every Mutable Column, All Optional

- An `Update` schema carries the client-settable columns that may change after creation, every field
  optional. It subclasses `UpdateModel` (`schemas/types.py`) and the route applies
  `data.apply_to(obj)`, never a hand-written loop: an absent field is left alone, which keeps "not
  sent" distinct from "set to null". No route reads a field off the model, which is what keeps
  `UNSET`'s typing fiction harmless.
- Fields over non-nullable columns keep their non-optional type and default to `UNSET`
  (`schemas/types.py`), so sending null is a 422 from pydantic; nullable columns declare `| None`,
  where null clears the value.
- The splat-safety argument for `XCreate` carries over: a server-owned or immutable column absent
  from the schema cannot be reached through it. Immutability is the schema omitting the field, and
  `Match.player_id` is the standing example: a match reaches its owner through its player, so a
  writable one would let a match walk across the ownership boundary, for a correction that
  delete-and-recreate serves better.

## A List Endpoint Returns Everything the Caller Owns

- Lists come back whole: every row of that kind the caller owns, filtered by nothing but ownership
  and any filter the caller asked for. There is no state a row can be in that hides it from its own
  list, since a row a coach wanted gone is deleted rather than hidden, so a screen showing the list
  and a screen fetching one by id can never disagree about what exists.

## Let Pydantic Raise the 422

- **Never raise a 422 by hand.** FastAPI auto-declares every route's 422 as `HTTPValidationError`,
  whose `detail` is a list of errors, and the generated TypeScript client unpacks it as one — so an
  `HTTPException(422, detail="...")` returns a shape the client cannot read.
- Validation that belongs to the shape of the data goes in a `field_validator` raising `ValueError`;
  FastAPI turns that into a correctly-shaped 422 on its own. A rule a `Create` and an `Update` share
  goes in an `Annotated` alias with an `AfterValidator` instead (`PlayedOn`, `DateOfBirth`), so the
  bound cannot drift between the two schemas.
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
- Which is also the test for whether to declare at all: a status the caller can act on gets
  declared, one it cannot does not. Sign-up's 409 and an outstanding transfer code's are branches a
  form takes; the ownership 404 is the same dead end whatever caused it, and stays undeclared. Take
  the test from what the status is for, not from what a neighbouring route in the file happens to
  do.
- Nothing catches this: the spec test only checks that the committed `openapi.json` matches the
  routes, and it does — `unknown` is what the routes asked for.

## Validation JSON Schema Cannot Express Needs a Twin

- Rules like the date-of-birth and played-on bounds exist only in Python, so the OpenAPI spec cannot
  carry them and the generated client will happily send a value the server rejects. Note it on the
  validator, and the form gets its own check.

## The Route Owns the Commit

- A helper that mutates rows leaves the `commit()` to its caller, so the write lands together with
  whatever else the request changed, or not at all. Dependencies are the exception, since no route
  wraps them: `current_coach` commits its own session housekeeping.
- Nothing catches a forgotten commit. `get_db` closes the session at the end of the request, which
  discards the work, and the shared-session fixture hides the omission from route tests.

## No `db.refresh()` After `commit()`

- The session is built with `expire_on_commit=False`, so attributes are still loaded after a commit.
  A refresh is a wasted round-trip that reads back exactly what is already in memory.
