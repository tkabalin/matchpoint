import io
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import httpx2
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from psycopg.errors import CheckViolation
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from matchpoint_api import photos
from matchpoint_api.auth import (
    SESSION_COOKIE,
    SESSION_LIFETIME,
    VERIFICATION_COOKIE,
    CurrentCoach,
    current_coach,
    hash_token,
    new_session_token,
)
from matchpoint_api.db import get_db
from matchpoint_api.main import create_app
from matchpoint_api.models import (
    Coach,
    CoachSession,
    DeletedMatch,
    EmailVerification,
    Match,
    MatchSet,
    PasswordReset,
    Player,
    PlayerSession,
    PlayerTransferCode,
    Point,
)
from matchpoint_api.password_policy import BREACHED, COMMON, CONTEXT, REPEATED, SEQUENTIAL
from matchpoint_api.routers.matches import CAPTURE_CLAIM_TTL
from matchpoint_api.security import hash_password, verify_password
from tests.conftest import (
    ORIGIN_HEADERS,
    TEST_ORIGIN,
    breach_every_password,
    break_the_breach_check,
    image_bytes,
    stored_photos,
)
from tests.factories import (
    make_coach,
    make_coach_session,
    make_deleted_match,
    make_match,
    make_match_set,
    make_password_reset,
    make_player,
    make_player_session,
    make_player_transfer_code,
    make_point,
    sign_in,
    verify_email,
)

SIGN_UP = {
    "email": "mike@example.com",
    "display_name": "Coach Mike",
    "password": "a-good-password",
}


def test_signing_up_returns_the_new_coach(client: TestClient, db_session: Session) -> None:
    verify_email(client, db_session, "mike@example.com")

    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "mike@example.com"
    assert body["display_name"] == "Coach Mike"
    assert uuid.UUID(body["id"])
    assert body["created_at"] is not None
    assert body["updated_at"] is not None


def test_signing_up_never_echoes_the_password_or_its_hash(
    client: TestClient, db_session: Session
) -> None:
    """The response is filtered by CoachRead, which carries neither field. Asserted on
    the plaintext too, since that one came in on this very request."""
    verify_email(client, db_session, "mike@example.com")

    response = client.post("/coaches", json=SIGN_UP)

    assert "password_hash" not in response.json()
    assert "password" not in response.json()
    assert "a-good-password" not in response.text


def test_signing_up_stores_a_hash_the_password_verifies_against(
    client: TestClient, db_session: Session
) -> None:
    """The end the route owns: the plaintext must not reach the column, and what does
    reach it has to be something a later login can check the password against."""
    verify_email(client, db_session, "mike@example.com")

    response = client.post("/coaches", json=SIGN_UP)

    coach = db_session.get(Coach, uuid.UUID(response.json()["id"]))
    assert coach is not None
    assert coach.password_hash != "a-good-password"
    assert coach.password_hash.startswith("$argon2id$")
    assert verify_password("a-good-password", coach.password_hash) is True
    assert verify_password("the-wrong-password", coach.password_hash) is False


def test_two_coaches_sharing_a_password_get_different_hashes(
    client: TestClient, db_session: Session
) -> None:
    """Per-hash salt, seen from the outside: two coaches who happened to choose the same
    password must not be visibly sharing it to anyone who reads the table."""
    verify_email(client, db_session, "mike@example.com")
    first = client.post("/coaches", json=SIGN_UP | {"email": "mike@example.com"})
    verify_email(client, db_session, "sam@example.com")
    second = client.post("/coaches", json=SIGN_UP | {"email": "sam@example.com"})

    hashes = set()
    for response in (first, second):
        coach = db_session.get(Coach, uuid.UUID(response.json()["id"]))
        assert coach is not None
        hashes.add(coach.password_hash)

    assert len(hashes) == 2


def test_a_mixed_case_email_is_stored_and_read_back_lowercased(
    client: TestClient, db_session: Session
) -> None:
    """EmailStr folds the domain, so the local part is the model's `validates` to do — and
    this is the test that fails if that ever comes out. Read back through a real login and
    /coaches/me, address typed with capitals both times, because that whole round trip is
    what storing lowercase exists to keep working. The verification row holds the folded
    address, so the mixed-case submission also proves the route folds before matching it."""
    verify_email(client, db_session, "Mike@Example.com")

    response = client.post("/coaches", json=SIGN_UP | {"email": "Mike@Example.com"})

    assert response.status_code == 201
    assert response.json()["email"] == "mike@example.com"

    login = {"email": "Mike@Example.com", "password": SIGN_UP["password"]}
    assert client.post("/auth/login", json=login).status_code == 200
    assert client.get("/coaches/me").json()["email"] == "mike@example.com"


def test_signing_up_twice_with_one_email_is_a_conflict(
    client: TestClient, db_session: Session
) -> None:
    """409 rather than the 500 an uncaught IntegrityError would be. Email is the sign-in
    identity, so the second attempt is not a duplicate row but an ambiguous login.

    The body is asserted too, because the route declares the 409 as ErrorDetail and the
    generated client is typed from that declaration — a response that stopped matching it
    would be a client reading a field that is not there.

    The second attempt gets a verification of its own — the first was consumed — so what
    is refused here is the duplicate email, not a spent cookie (that 401 has its own
    test)."""
    verify_email(client, db_session, "mike@example.com")
    assert client.post("/coaches", json=SIGN_UP).status_code == 201
    verify_email(client, db_session, "mike@example.com")

    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 409
    assert response.json() == {"detail": "Email already registered"}
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 1


def test_an_email_differing_only_in_case_is_a_conflict(
    client: TestClient, db_session: Session
) -> None:
    """The case a plain UNIQUE constraint would miss, since Postgres compares it
    case-sensitively — it is the model lowercasing on the way in that turns this into the
    same address, and so into the conflict above."""
    verify_email(client, db_session, "mike@example.com")
    assert client.post("/coaches", json=SIGN_UP | {"email": "mike@example.com"}).status_code == 201
    verify_email(client, db_session, "MIKE@Example.com")

    response = client.post("/coaches", json=SIGN_UP | {"email": "MIKE@Example.com"})

    assert response.status_code == 409


def test_an_integrity_error_that_is_not_a_duplicate_email_is_not_a_conflict(
    client: TestClient, db_session: Session
) -> None:
    """Only the unique email becomes a 409. Any other integrity failure is a bug, and
    answering "email already registered" would send whoever hit it looking in the wrong
    place — so the route re-raises and it stays a server error.

    Reaching that arm takes some doing, because the constraint it fires on is one the ORM
    makes unreachable: `validates` lowercases every email on assignment, so
    coach_email_lowercase can only be tripped by a write that skipped it. Writing into the
    instance dictionary is that write — validators hook attribute assignment, not the dict
    behind it — and flag_modified is what still gets the change into the next flush. That
    flush has to be the one the route's own commit performs, and the route flushes earlier
    than it used to: consuming the verification autoflushes whatever is already dirty. So
    the doctoring waits inside a before_flush hook until the route's new Coach is pending —
    the one flush that is the commit's.
    """
    coach = make_coach(db_session)
    db_session.commit()
    verify_email(client, db_session, "mike@example.com")

    @event.listens_for(db_session, "before_flush")
    def _doctor(session: Session, _context: object, _instances: object) -> None:
        if any(isinstance(pending, Coach) for pending in session.new):
            vars(coach)["email"] = "MIKE@example.com"
            flag_modified(coach, "email")

    with pytest.raises(IntegrityError) as caught:
        client.post("/coaches", json=SIGN_UP)

    assert isinstance(caught.value.orig, CheckViolation)


def test_signing_up_without_a_password_is_rejected(client: TestClient) -> None:
    response = client.post("/coaches", json={k: v for k, v in SIGN_UP.items() if k != "password"})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "password"]


def test_signing_up_with_too_short_a_password_is_rejected(client: TestClient) -> None:
    """The bound is CoachCreate's, checked here to pin that it is wired into the route —
    the exhaustive cases live in tests/schemas/test_coach.py."""
    response = client.post("/coaches", json=SIGN_UP | {"password": "short"})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "password"]


def test_a_rejected_sign_up_does_not_echo_the_password(client: TestClient) -> None:
    """The handler in errors.py, seen through the route it exists for — the plaintext would
    otherwise come back in detail[].input and land in devtools and any body-logging proxy.

    Both shapes are checked, because they leak by different routes: an error on the
    password reports the password as its input, while an error on another field reports the
    whole submitted body, password and all. The second is the one a check on the field name
    alone would miss.
    """
    on_the_password = client.post("/coaches", json=SIGN_UP | {"password": "hunter2"})
    on_the_email = client.post("/coaches", json={k: v for k, v in SIGN_UP.items() if k != "email"})

    assert on_the_password.status_code == 422
    assert "hunter2" not in on_the_password.text
    assert on_the_email.status_code == 422
    assert "a-good-password" not in on_the_email.text


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("aaaaaaaa", REPEATED),
        ("abcdefgh", SEQUENTIAL),
        ("password", COMMON),
        # The context rule reading this very body: SIGN_UP is Coach Mike at mike@.
        ("mike-and-more", CONTEXT),
    ],
)
def test_signing_up_with_a_password_the_policy_refuses_is_a_400(
    client: TestClient, db_session: Session, password: str, reason: str
) -> None:
    """#141's rejections through the route. A 400 rather than a 422 because the reason is a
    sentence and FastAPI declares every 422 as a list of field errors; the exhaustive cases
    live in tests/test_password_policy.py."""
    verify_email(client, db_session, "mike@example.com")

    response = client.post("/coaches", json=SIGN_UP | {"password": password})

    assert response.status_code == 400
    assert response.json() == {"detail": reason}
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 0


def test_a_refused_password_leaves_the_verification_to_try_again_with(
    client: TestClient, db_session: Session
) -> None:
    """Why the check runs before the consume: a password the policy refuses is a
    correction, not a reason to send the coach back for a fresh code."""
    verify_email(client, db_session, "mike@example.com")

    assert client.post("/coaches", json=SIGN_UP | {"password": "aaaaaaaa"}).status_code == 400

    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 1
    assert client.post("/coaches", json=SIGN_UP).status_code == 201


def test_signing_up_with_a_breached_password_is_a_400(
    client: TestClient, db_session: Session
) -> None:
    """#140 through the route, on the same 400 as the local rules: one status, and the
    body says which reason. The corpus itself is `tests/test_breach.py`'s subject."""
    verify_email(client, db_session, "mike@example.com")
    breach_every_password(client)

    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 400
    assert response.json() == {"detail": BREACHED}
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 0


def test_a_breached_password_also_leaves_the_verification_standing(
    client: TestClient, db_session: Session
) -> None:
    """The corpus lookup inherits the local rules' place ahead of the consume, which is
    what it has to do: a coach correcting their password should not need a fresh code."""
    verify_email(client, db_session, "mike@example.com")
    breach_every_password(client)

    assert client.post("/coaches", json=SIGN_UP).status_code == 400

    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 1


def test_signing_up_survives_a_corpus_that_cannot_answer(
    client: TestClient, db_session: Session
) -> None:
    """Fail-open end to end. A third party being down must not be able to stop anyone
    creating an account; `docs/security.md` records why that is the right way to fail."""
    verify_email(client, db_session, "mike@example.com")
    break_the_breach_check(client)

    assert client.post("/coaches", json=SIGN_UP).status_code == 201


def test_a_password_refused_by_policy_is_not_echoed(
    client: TestClient, db_session: Session
) -> None:
    """The 400 carries our own sentence and never the submitted value, so the leak
    errors.py closes on the 422 path has no way back in here."""
    verify_email(client, db_session, "mike@example.com")

    response = client.post("/coaches", json=SIGN_UP | {"password": "mike-and-more"})

    assert response.status_code == 400
    assert "mike-and-more" not in response.text


def test_signing_up_without_a_verification_cookie_is_a_401(
    client: TestClient, db_session: Session
) -> None:
    """The check #44 exists for: no proof the address was verified, no account. The body
    is asserted because the route declares the 401 as ErrorDetail and the generated
    client is typed from that declaration."""
    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 401
    assert response.json() == {"detail": "Email not verified"}
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 0


def test_signing_up_with_a_cookie_for_another_email_is_a_401(
    client: TestClient, db_session: Session
) -> None:
    """A cookie proving sam@ was verified must not authorise an account for mike@ —
    and being refused must not burn sam's verification, which the mismatch never
    matched."""
    verify_email(client, db_session, "sam@example.com")

    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 401
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 0
    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 1


def test_signing_up_with_an_expired_verification_is_a_401(
    client: TestClient, db_session: Session
) -> None:
    """The cookie's Max-Age usually gets there first, but the row's expiry is the bound
    the server owns — a replayed cookie must not outlive it."""
    verify_email(
        client, db_session, "mike@example.com", expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )

    assert client.post("/coaches", json=SIGN_UP).status_code == 401


def test_signing_up_with_a_token_verify_otp_never_minted_is_a_401(client: TestClient) -> None:
    """A forged cookie: syntactically fine, hashing to nothing in the table. Same 401 as
    no cookie at all — the difference is server bookkeeping, not something to describe
    to whoever is probing."""
    client.cookies.set(VERIFICATION_COOKIE, new_session_token())

    assert client.post("/coaches", json=SIGN_UP).status_code == 401


def test_signing_up_consumes_the_verification(client: TestClient, db_session: Session) -> None:
    """Single-use, seen from the table: the row the cookie proved is gone the moment it
    has done its job, so nothing is left for a second account to present."""
    verify_email(client, db_session, "mike@example.com")

    assert client.post("/coaches", json=SIGN_UP).status_code == 201

    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 0


def test_a_spent_verification_cookie_cannot_sign_up_again(
    client: TestClient, db_session: Session
) -> None:
    """Single-use, seen from the wire: replaying the cookie that just created an account
    is a 401 — not the 409 a fresh verification would earn, because the consumption
    check runs before the duplicate email is ever asked about.

    This is also the answer a sign-up whose 201 was lost gets when it retries, which is
    the deliberate half of it: reaching the 409 there would mean answering an
    unauthenticated caller's question about which addresses are registered, and
    requesting a fresh code answers that caller's real question instead."""
    verify_email(client, db_session, "mike@example.com")
    assert client.post("/coaches", json=SIGN_UP).status_code == 201

    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 401
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 1


def test_a_conflict_does_not_burn_the_verification(client: TestClient, db_session: Session) -> None:
    """The 409 path rolls the whole transaction back, consumption included: the consume
    and the insert are one transaction, so a sign-up that fails leaves the table exactly
    as it found it rather than half-applied.

    Reaching this state takes a race — request-otp refuses a registered address, so the
    only way to hold a live verification for one is to have someone else register the
    address between your verify-otp and your sign-up. The preserved row wins that loser
    nothing (every retry collides the same way); the invariant is what is under test."""
    verify_email(client, db_session, "mike@example.com")
    assert client.post("/coaches", json=SIGN_UP).status_code == 201
    verify_email(client, db_session, "mike@example.com")

    assert client.post("/coaches", json=SIGN_UP).status_code == 409

    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 1


def test_sign_up_arrivals_beyond_the_burst_are_refused(client: TestClient) -> None:
    """The bound #26 exists for, pinned at the per-address burst create_app sizes (10).

    The filler bodies are invalid on purpose, and the refusal arriving as a 429 rather
    than their 422 is half the point: the limit counts arrivals before validation ever
    runs, so a refused request spends no parsing, no session, and no Argon2 hash. The
    body is asserted exactly because the route declares the 429 as ErrorDetail and the
    generated client is typed from that declaration.
    """
    for _ in range(10):
        assert client.post("/coaches", json={}).status_code == 422

    response = client.post("/coaches", json={})

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    assert int(response.headers["Retry-After"]) >= 1


@pytest.mark.usefixtures("clock")
def test_sign_up_has_a_total_bound_no_address_escapes(client: TestClient) -> None:
    """The shared tier is the actual arrival bound: behind Cloudflare the per-address key
    is an edge address an attacker can occupy many of, so a spread-out flood must still
    hit a ceiling. Two addresses drain the shared burst create_app sizes (10) without
    exhausting their own buckets; a third is refused on its very first request."""
    for address in ("203.0.113.1", "203.0.113.2"):
        from_address = TestClient(client.app, headers=ORIGIN_HEADERS, client=(address, 50000))
        for _ in range(5):
            assert from_address.post("/coaches", json={}).status_code == 422

    latecomer = TestClient(client.app, headers=ORIGIN_HEADERS, client=("203.0.113.3", 50000))

    assert latecomer.post("/coaches", json={}).status_code == 429


@pytest.mark.usefixtures("clock")
def test_a_sign_up_refused_by_the_shared_tier_spends_no_per_address_token(
    client: TestClient,
) -> None:
    """A coach arriving mid-flood is refused by a tier they are not part of, so their own
    bucket must be untouched: otherwise, obeying the Retry-After they were handed would
    spend it a request at a time and leave them locked out after the flood had passed. The
    per-address dict is asserted directly because "spent nothing" is a claim about state
    the response cannot show — an untouched bucket is one that was never even created."""
    for address in ("203.0.113.1", "203.0.113.2"):
        from_address = TestClient(client.app, headers=ORIGIN_HEADERS, client=(address, 50000))
        for _ in range(5):
            from_address.post("/coaches", json={})

    mid_flood = TestClient(client.app, headers=ORIGIN_HEADERS, client=("203.0.113.9", 50000))
    for _ in range(3):
        assert mid_flood.post("/coaches", json={}).status_code == 429

    # cast because TestClient types the app it was handed as a bare ASGI callable.
    per_ip = cast(FastAPI, client.app).state.sign_up_per_ip_limit

    assert "203.0.113.9" not in per_ip._buckets


def test_me_returns_the_signed_in_coach_and_nobody_else(
    client: TestClient, db_session: Session
) -> None:
    """The cookie decides whose row comes back — with two coaches in the table, /me
    must resolve to the one the session belongs to."""
    make_coach(db_session, email="other@example.com")
    coach = make_coach(db_session, email="mike@example.com", display_name="Coach Mike")
    sign_in(client, db_session, coach)

    response = client.get("/coaches/me")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(coach.id)
    assert body["email"] == "mike@example.com"
    assert body["display_name"] == "Coach Mike"
    assert body["created_at"] is not None
    assert body["updated_at"] is not None


def test_me_without_a_cookie_is_a_401(client: TestClient) -> None:
    response = client.get("/coaches/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_me_with_a_token_no_login_minted_is_a_401(client: TestClient, db_session: Session) -> None:
    """A forged or revoked token: syntactically fine, hashing to nothing in the
    table. Same 401 as no cookie at all — the difference is server bookkeeping,
    not something to describe to whoever is probing."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    client.cookies.set(SESSION_COOKIE, new_session_token())

    assert client.get("/coaches/me").status_code == 401


def test_me_with_an_expired_session_is_a_401_and_discards_it(
    client: TestClient, db_session: Session
) -> None:
    """Being presented is the one moment a single expired row is in hand, so rejection
    is also when it is deleted; the rows never presented again are caught by the
    probabilistic sweep."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach, expires_at=datetime.now(UTC) - timedelta(seconds=1))

    response = client.get("/coaches/me")

    assert response.status_code == 401
    assert db_session.scalar(select(func.count()).select_from(CoachSession)) == 0


def test_me_renews_a_session_past_its_half_life(client: TestClient, db_session: Session) -> None:
    """Renewal on use is what makes the fixed lifetime safe courtside: any activity
    in the second half of a session's life pushes expiry a full lifetime out, so only
    an *abandoned* login can ever actually expire."""
    coach = make_coach(db_session)
    session_row = sign_in(
        client, db_session, coach, expires_at=datetime.now(UTC) + timedelta(days=5)
    )

    assert client.get("/coaches/me").status_code == 200

    assert session_row.expires_at > datetime.now(UTC) + SESSION_LIFETIME - timedelta(minutes=1)


def test_a_renewed_session_re_sends_the_cookie(client: TestClient, db_session: Session) -> None:
    """Renewing the row is only half of it: Max-Age is absolute from the moment the
    cookie is sent, so a browser told nothing would drop its copy on the original
    deadline — signing out the coach who used the app every single day, which is exactly
    the silent expiry courtside that the renewal exists to rule out."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach, expires_at=datetime.now(UTC) + timedelta(days=5))
    token = client.cookies[SESSION_COOKIE]

    header = client.get("/coaches/me").headers["set-cookie"]

    assert header.startswith(f"{SESSION_COOKIE}={token}")
    assert f"max-age={int(SESSION_LIFETIME.total_seconds())}" in header.lower()


def test_a_renewal_reaches_the_browser_even_on_an_error_response(db_session: Session) -> None:
    """The renewal is a fact about the session, so it must not depend on how the request
    went. An error answer is built by an exception handler, not by the route, so a cookie
    written to the route's own response is dropped — leaving the row renewed and the
    browser still counting down to the old deadline. Nothing renews it again until the
    *new* halfway mark, so the coach is signed out mid-season having used the app daily.

    Built on its own app because no route on this branch both authenticates and fails,
    and the failing half is the whole point of the test.
    """
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session

    @app.get("/boom")
    def boom(_coach: CurrentCoach) -> None:
        raise HTTPException(status_code=418, detail="Nothing to do with the session")

    coach = make_coach(db_session)
    token = new_session_token()
    session_row = make_coach_session(
        db_session,
        coach_id=coach.id,
        token_hash=hash_token(token),
        expires_at=datetime.now(UTC) + timedelta(days=5),
    )
    db_session.commit()

    with TestClient(app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS) as failing_client:
        failing_client.cookies.set(SESSION_COOKIE, token)
        response = failing_client.get("/boom")

    assert response.status_code == 418
    assert session_row.expires_at > datetime.now(UTC) + SESSION_LIFETIME - timedelta(minutes=1)
    assert response.headers["set-cookie"].startswith(f"{SESSION_COOKIE}={token}")


def test_a_renewal_reaches_the_browser_even_when_the_route_crashes(db_session: Session) -> None:
    """The same promise on the one response no middleware writes. `current_coach` has
    already committed the new deadline by the time a route raises, so a 500 that dropped
    the cookie would sign the coach out on a deadline the server no longer holds.
    """
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session

    @app.get("/boom")
    def boom(_coach: CurrentCoach) -> None:
        raise RuntimeError('relation "password_resets" does not exist')

    coach = make_coach(db_session)
    token = new_session_token()
    session_row = make_coach_session(
        db_session,
        coach_id=coach.id,
        token_hash=hash_token(token),
        expires_at=datetime.now(UTC) + timedelta(days=5),
    )
    db_session.commit()

    with TestClient(
        app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS, raise_server_exceptions=False
    ) as failing_client:
        failing_client.cookies.set(SESSION_COOKIE, token)
        response = failing_client.get("/boom")

    assert response.status_code == 500
    assert session_row.expires_at > datetime.now(UTC) + SESSION_LIFETIME - timedelta(minutes=1)
    assert response.headers["set-cookie"].startswith(f"{SESSION_COOKIE}={token}")


def test_me_leaves_a_session_in_its_first_half_alone(
    client: TestClient, db_session: Session
) -> None:
    """The other side of the halfway mark: renewing on every request would turn every
    read into a write, so a young session must come through untouched."""
    coach = make_coach(db_session)
    session_row = sign_in(client, db_session, coach)
    expires_at = session_row.expires_at

    assert client.get("/coaches/me").status_code == 200

    assert session_row.expires_at == expires_at


def test_an_authenticated_request_may_sweep_all_expired_sessions(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Probabilistic GC: a fraction of authenticated requests sweep every expired
    row from the table, catching the sessions no login ever presents again."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    other_coach = make_coach(db_session)
    expired = make_coach_session(
        db_session, coach_id=other_coach.id, expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    live = make_coach_session(db_session, coach_id=other_coach.id)
    db_session.commit()

    monkeypatch.setattr("matchpoint_api.auth.secrets.randbelow", lambda _: 0)
    assert client.get("/coaches/me").status_code == 200

    assert db_session.get(CoachSession, expired.id) is None
    assert db_session.get(CoachSession, live.id) is not None


def test_a_missed_gc_roll_leaves_expired_sessions_alone(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the roll misses, no sweep runs, so expired sessions from other coaches
    survive until a future request's roll hits or the owning coach logs in."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    other_coach = make_coach(db_session)
    expired = make_coach_session(
        db_session, coach_id=other_coach.id, expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    db_session.commit()

    monkeypatch.setattr("matchpoint_api.auth.secrets.randbelow", lambda _: 1)
    assert client.get("/coaches/me").status_code == 200

    assert db_session.get(CoachSession, expired.id) is not None


def test_me_never_returns_the_password_hash(client: TestClient, db_session: Session) -> None:
    """Checked at the boundary that matters: response_model filters a response to
    CoachRead's fields, so the hash is dropped here — but only for as long as CoachRead
    leaves it out. Sign-up and login return a Coach row too, and are asserted on
    separately."""
    coach = make_coach(db_session, password_hash="not-a-real-hash")
    sign_in(client, db_session, coach)

    response = client.get("/coaches/me")

    assert response.status_code == 200
    assert "password_hash" not in response.json()
    assert "not-a-real-hash" not in response.text


def test_updating_the_display_name_stores_the_new_one(
    client: TestClient, db_session: Session
) -> None:
    """What #60 exists for: a name typed once at sign-up was permanent. Read back with
    a query rather than off the instance the route mutated, since the claim is that the
    commit reached the row. updated_at is asserted because nothing sets it by hand."""
    coach = make_coach(db_session, display_name="Coch Mike")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={"display_name": "Coach Mike"})

    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Coach Mike"
    assert datetime.fromisoformat(body["updated_at"]) > datetime.fromisoformat(body["created_at"])
    stored = db_session.scalar(select(Coach.display_name).where(Coach.id == coach.id))
    assert stored == "Coach Mike"


def test_updating_the_preferences_stores_them(client: TestClient, db_session: Session) -> None:
    """The storage half of #97: the match-setup defaults live on the coach row, and this
    PATCH is the one write path they have. Read back with a query, as above."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)

    response = client.patch(
        "/coaches/me",
        json={"default_surface": "clay", "default_scoring_system": "short_sets"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["default_surface"] == "clay"
    assert body["default_scoring_system"] == "short_sets"
    stored = db_session.execute(
        select(Coach.default_surface, Coach.default_scoring_system).where(Coach.id == coach.id)
    ).one()
    assert stored == ("clay", "short_sets")


def test_updating_a_preference_to_null_clears_it(client: TestClient, db_session: Session) -> None:
    """Null clears where absent leaves alone — the nullable-column half of the PATCH
    semantics, and the sent field must not drag the unsent one with it."""
    coach = make_coach(db_session, default_surface="clay", default_scoring_system="short_sets")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={"default_surface": None})

    assert response.status_code == 200
    assert response.json()["default_surface"] is None
    stored = db_session.execute(
        select(Coach.default_surface, Coach.default_scoring_system).where(Coach.id == coach.id)
    ).one()
    assert stored == (None, "short_sets")


@pytest.mark.parametrize(
    ("field", "value"),
    [("default_surface", "sand"), ("default_scoring_system", "best_of_3")],
)
def test_updating_to_a_preference_outside_its_enum_is_rejected(
    client: TestClient, db_session: Session, field: str, value: str
) -> None:
    """The enum members, pinned as wired into this route; a rejected update leaves the
    stored preference alone."""
    coach = make_coach(db_session, default_surface="hard")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={field: value})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", field]
    stored = db_session.scalar(select(Coach.default_surface).where(Coach.id == coach.id))
    assert stored == "hard"


def test_me_returns_null_preferences_until_they_are_set(
    client: TestClient, db_session: Session
) -> None:
    """No preference is a state, not an error: a fresh coach reads back explicit nulls,
    which is what tells the setup form there is nothing to prefill."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)

    response = client.get("/coaches/me")

    assert response.status_code == 200
    body = response.json()
    assert body["default_surface"] is None
    assert body["default_scoring_system"] is None


def test_an_update_sending_no_fields_changes_nothing(
    client: TestClient, db_session: Session
) -> None:
    """An absent field means leave it alone, so a body carrying none of them is a 200
    that writes nothing, which is the semantics UNSET buys, seen from the wire."""
    coach = make_coach(db_session, display_name="Coach Mike")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={})

    assert response.status_code == 200
    assert response.json()["display_name"] == "Coach Mike"
    stored = db_session.scalar(select(Coach.display_name).where(Coach.id == coach.id))
    assert stored == "Coach Mike"


def test_updating_the_display_name_to_null_is_rejected(
    client: TestClient, db_session: Session
) -> None:
    """The other half of UNSET: omitting the field is a no-op, but asking to clear it is
    a 422, because the column is NOT NULL and has no blank name to hold."""
    coach = make_coach(db_session, display_name="Coach Mike")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={"display_name": None})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "display_name"]


@pytest.mark.parametrize("display_name", ["   ", "x" * 101])
def test_updating_to_a_display_name_outside_the_bounds_is_rejected(
    client: TestClient, db_session: Session, display_name: str
) -> None:
    """ShortText's bounds, pinned as wired into this route; the exhaustive cases live in
    tests/schemas/test_coach.py. A rejected update leaves the stored name alone."""
    coach = make_coach(db_session, display_name="Coach Mike")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={"display_name": display_name})

    assert response.status_code == 422
    stored = db_session.scalar(select(Coach.display_name).where(Coach.id == coach.id))
    assert stored == "Coach Mike"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("email", "attacker@example.com"),
        ("password", "a-new-password"),
        ("password_hash", "not-a-hash-either"),
    ],
)
def test_an_update_refuses_a_field_the_schema_leaves_out(
    client: TestClient, db_session: Session, field: str, value: str
) -> None:
    """CoachUpdate carries display_name alone, so the sign-in identity and the credential
    are out of reach here. RequestModel's extra="forbid" turns the unknown key into a
    422 rather than a silent drop, and the request changed nothing."""
    coach = make_coach(db_session, email="mike@example.com", password_hash="not-a-real-hash")
    sign_in(client, db_session, coach)

    response = client.patch("/coaches/me", json={"display_name": "Coach Mike", field: value})

    assert response.status_code == 422
    # display_name too, though it is the one field the schema does carry: the refusal has
    # to take the whole body with it, not apply the half it recognised.
    stored = db_session.execute(
        select(Coach.email, Coach.password_hash, Coach.display_name).where(Coach.id == coach.id)
    ).one()
    assert stored == ("mike@example.com", "not-a-real-hash", "Test Coach")


def test_updating_without_a_cookie_is_a_401(client: TestClient) -> None:
    """The route declares the 401 as ErrorDetail, as GET /me does, and the generated
    client is typed from that declaration."""
    response = client.patch("/coaches/me", json={"display_name": "Coach Mike"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


# --- Profile photos: POST and DELETE /coaches/me/photo ---


def _upload(client: TestClient, data: bytes | None = None) -> httpx2.Response:
    """A multipart POST, which is the only way image bytes reach a JSON API."""
    return client.post("/coaches/me/photo", files={"file": ("photo.png", data or image_bytes())})


def test_uploading_a_photo_answers_with_the_coach(
    client: TestClient, db_session: Session, media_root: Path
) -> None:
    """The whole coach rather than the URL alone: a new photo is a new key, so this is
    the only place the caller learns where it went."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)

    response = _upload(client)

    assert response.status_code == 200
    body = response.json()
    assert body["photo_url"] == f"/api/media/{coach.photo_key}{photos.EXTENSION}"
    assert len(stored_photos(media_root)) == 1


def test_an_uploaded_photo_is_served_at_the_url_it_reports(
    client: TestClient, db_session: Session
) -> None:
    """The reported URL carries /api, which Caddy and the dev proxy strip before the app
    ever sees it; a test client is fronted by neither, so it asks for what arrives."""
    sign_in(client, db_session, make_coach(db_session))
    photo_url = _upload(client).json()["photo_url"]

    response = client.get(photo_url.removeprefix("/api"))

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "image/webp"
    with Image.open(io.BytesIO(response.content)) as served:
        assert served.size == (photos.SIZE, photos.SIZE)


def test_replacing_a_photo_removes_the_one_it_replaced(
    client: TestClient, db_session: Session, media_root: Path
) -> None:
    sign_in(client, db_session, make_coach(db_session))
    first = _upload(client).json()["photo_url"]

    second = _upload(client).json()["photo_url"]

    assert first != second
    assert len(stored_photos(media_root)) == 1


def test_clearing_a_photo_removes_the_file(
    client: TestClient, db_session: Session, media_root: Path
) -> None:
    sign_in(client, db_session, make_coach(db_session))
    _upload(client)

    response = client.delete("/coaches/me/photo")

    assert response.status_code == 200
    assert response.json()["photo_url"] is None
    assert stored_photos(media_root) == []


def test_clearing_a_photo_that_is_not_there_is_a_no_op(
    client: TestClient, db_session: Session
) -> None:
    """Not a 404, for the reason archiving twice is not: a retried request must neither
    error nor move the row."""
    sign_in(client, db_session, make_coach(db_session))

    response = client.delete("/coaches/me/photo")

    assert response.status_code == 200
    assert response.json()["photo_url"] is None


def test_a_file_that_is_not_an_image_is_refused(
    client: TestClient, db_session: Session, media_root: Path
) -> None:
    """400 rather than a hand-raised 422, whose `detail` the generated client reads as a
    list of validation errors and not as a message a form can show."""
    sign_in(client, db_session, make_coach(db_session))

    response = _upload(client, b"this is not an image")

    assert response.status_code == 400
    assert response.json()["detail"] == photos.NOT_AN_IMAGE
    assert stored_photos(media_root) == []


def test_an_image_with_too_many_pixels_is_refused(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Monkeypatched rather than built: a genuine 12-megapixel upload would cost tens of
    megabytes and seconds a run to prove the same refusal."""
    sign_in(client, db_session, make_coach(db_session))
    monkeypatch.setattr(photos, "MAX_PIXELS", 4)

    response = _upload(client)

    assert response.status_code == 400
    assert response.json()["detail"] == photos.TOO_MANY_PIXELS


def test_an_upload_with_no_file_part_is_a_422(client: TestClient, db_session: Session) -> None:
    """FastAPI's own, so `detail` stays the list the generated client unpacks."""
    sign_in(client, db_session, make_coach(db_session))

    response = client.post("/coaches/me/photo")

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_uploading_a_photo_needs_a_session(client: TestClient) -> None:
    assert _upload(client).status_code == 401


def test_clearing_a_photo_needs_a_session(client: TestClient) -> None:
    assert client.delete("/coaches/me/photo").status_code == 401


def test_clearing_a_photo_answers_401_when_the_coach_is_already_gone(
    db_session: Session,
) -> None:
    """`current_coach` reads the row without a lock, so the re-select FOR UPDATE the photo
    routes take can find it gone: closing the account in another request is what does it.

    Injected rather than arranged, because authentication and the lock read one database
    here: a row the session cookie can still be resolved against is a row that is there.
    """
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    coach = make_coach(db_session)
    db_session.delete(coach)
    db_session.flush()
    app.dependency_overrides[current_coach] = lambda: coach

    with TestClient(app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS) as closed_client:
        response = closed_client.delete("/coaches/me/photo")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not signed in"


@pytest.mark.usefixtures("clock")
def test_uploads_are_rate_limited_per_coach(client: TestClient, db_session: Session) -> None:
    """Pinned at the per-coach burst create_app sizes (10). A decode is CPU behind a
    one-slot semaphore, which the authenticated budget's burst of 600 would let a stolen
    session spend the box's one core on."""
    sign_in(client, db_session, make_coach(db_session))

    for _ in range(10):
        assert _upload(client).status_code == 200
    response = _upload(client)

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    assert int(response.headers["Retry-After"]) >= 1


# --- Closing an account: DELETE /coaches/me ---

CLOSE_PASSWORD = "a-good-password"


def _closable(client: TestClient, db_session: Session, **overrides: Any) -> Coach:
    """A signed-in coach whose stored hash CLOSE_PASSWORD really verifies against.

    One real hash rather than a sign-up and a login, as the change-password tests arrange
    theirs: these are about the closure, not about how the session was earned.
    """
    coach = make_coach(db_session, password_hash=hash_password(CLOSE_PASSWORD), **overrides)
    sign_in(client, db_session, coach)
    return coach


def _close(client: TestClient, **overrides: object) -> httpx2.Response:
    """request() rather than delete(): httpx's delete() takes no body, and the password
    has to be in one: a credential in a query string lands in access logs."""
    body: dict[str, object] = {"password": CLOSE_PASSWORD} | overrides
    return client.request("DELETE", "/coaches/me", json=body)


def _stub_out_verification(monkeypatch: pytest.MonkeyPatch, *, answer: bool) -> None:
    """Answer every password the same way, for the tests that need volume rather than real
    hashing: at ~165 ms an Argon2 run, ten closures would cost most of two seconds."""
    monkeypatch.setattr("matchpoint_api.routers.coaches.verify_password", lambda *_: answer)


def test_closing_an_account_erases_the_coach(client: TestClient, db_session: Session) -> None:
    """The row itself goes, rather than being flagged as closed: a row left behind would
    keep the email, the display name and the password hash that closure exists to remove."""
    coach = _closable(client, db_session)

    response = _close(client)

    assert response.status_code == 204
    assert db_session.get(Coach, coach.id) is None


def test_closing_an_account_takes_every_photo_under_it(
    client: TestClient, db_session: Session, media_root: Path
) -> None:
    """The one place the keys have to be read before the deletes rather than after: once
    the rows are gone there is nothing left to say which files they named."""
    coach = _closable(client, db_session, photo_key=photos.store(image_bytes()))
    make_player(db_session, coach_id=coach.id, photo_key=photos.store(image_bytes()))
    make_player(db_session, coach_id=coach.id)
    db_session.commit()
    assert len(stored_photos(media_root)) == 2

    assert _close(client, delete_players=True).status_code == 204

    assert stored_photos(media_root) == []


def test_closing_an_account_is_refused_while_a_player_is_active(
    client: TestClient, db_session: Session
) -> None:
    """A name still on the roster may be one another coach is about to take over (#173),
    so it has to be cleared before the account can erase it. The body is asserted exactly
    because the route declares the 409 as ErrorDetail for the form to branch on."""
    coach = _closable(client, db_session)
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = _close(client)

    assert response.status_code == 409
    assert response.json() == {"detail": "Players must be transferred or deleted first"}
    assert db_session.get(Coach, coach.id) is not None
    assert db_session.get(Player, player.id) is not None
    assert client.get("/coaches/me").status_code == 200


def test_a_refusal_spends_none_of_the_wrong_guess_budget(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Why the roster check sits after the password rather than in place of a failure: the
    password was right every time, so a coach working out what the refusal wants must not
    be locked out of their own closure by the tier that bounds guessing (burst 5)."""
    coach = _closable(client, db_session)
    make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _stub_out_verification(monkeypatch, answer=True)

    for _ in range(6):
        assert _close(client).status_code == 409

    assert _close(client, delete_players=True).status_code == 204
    assert db_session.get(Coach, coach.id) is None


def test_closing_an_account_may_take_the_roster_along(
    client: TestClient, db_session: Session
) -> None:
    """The one-step closure for the coach who wants out: clearing the roster and erasing
    the account share a transaction, so there is no half-closed account to be stranded in
    between the two. Every table below the coach is checked: one left out of the delete
    list would refuse the whole thing, its foreign key declaring no ondelete, and the
    derived set rows that do cascade would be a 500 here if that ever changed."""
    coach = _closable(client, db_session)
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    make_match_set(db_session, match_id=match.id)
    point = make_point(db_session, match_id=match.id)
    reset = make_password_reset(db_session, coach_id=coach.id)
    session_row = make_coach_session(db_session, coach_id=coach.id)
    player_session = make_player_session(db_session, player_id=player.id)
    db_session.commit()

    response = _close(client, delete_players=True)

    assert response.status_code == 204
    assert db_session.get(Coach, coach.id) is None
    assert db_session.get(Player, player.id) is None
    assert db_session.get(Match, match.id) is None
    assert db_session.get(Point, point.id) is None
    # Counted, not fetched by id: the cascade happens in the database, where the session
    # cannot see it, so its own copy of the row would answer a get() as if it were there.
    assert db_session.scalar(select(func.count()).select_from(MatchSet)) == 0
    assert db_session.get(PasswordReset, reset.id) is None
    assert db_session.get(CoachSession, session_row.id) is None
    assert db_session.get(PlayerSession, player_session.id) is None
    assert client.get("/coaches/me").status_code == 401


def test_closing_an_account_takes_a_match_being_captured_with_it(
    client: TestClient, db_session: Session
) -> None:
    """The refusal a live capture claim puts on the match's own delete route stops there,
    as it does for the player delete. A transfer code refuses here because it is another
    coach's pending claim; a capture claim is this coach's own device, and a device that
    died holding one must not hold an account open until the claim lapses."""
    coach = _closable(client, db_session)
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        capture_claim_device_id=uuid.uuid4(),
        capture_claim_expires_at=datetime.now(UTC) + CAPTURE_CLAIM_TTL,
    )
    db_session.commit()

    assert _close(client, delete_players=True).status_code == 204
    assert db_session.get(Match, match.id) is None


def test_closing_an_account_ends_every_session_and_clears_the_cookie(
    client: TestClient, db_session: Session
) -> None:
    """Every session, not just the one that asked: the coach is gone, so no device of
    theirs has anything left to be signed in to."""
    coach = _closable(client, db_session)
    make_coach_session(db_session, coach_id=coach.id)
    db_session.commit()

    response = _close(client)

    assert response.status_code == 204
    assert (
        db_session.scalar(
            select(func.count()).select_from(CoachSession).where(CoachSession.coach_id == coach.id)
        )
        == 0
    )
    assert response.cookies.get(SESSION_COOKIE) is None
    assert client.get("/coaches/me").status_code == 401


def test_a_closure_from_a_session_due_for_renewal_sends_no_renewed_cookie(
    client: TestClient, db_session: Session
) -> None:
    """current_coach renews a session past its half-life through the middleware, which
    writes after this response is built. Left alone it would re-set the cookie the closure
    had just deleted, leaving the browser presenting a token for a coach who is gone."""
    coach = _closable(client, db_session)
    session_row = db_session.scalar(select(CoachSession).where(CoachSession.coach_id == coach.id))
    assert session_row is not None
    session_row.expires_at = datetime.now(UTC) + timedelta(days=1)
    db_session.commit()

    response = _close(client)

    assert response.status_code == 204
    assert len(response.headers.get_list("set-cookie")) == 1
    assert response.cookies.get(SESSION_COOKIE) is None


def test_closing_an_account_deletes_a_live_reset_code(
    client: TestClient, db_session: Session
) -> None:
    """The foreign key from password_resets has no ondelete either, so an unclaimed code
    left behind would refuse the delete outright."""
    coach = _closable(client, db_session)
    reset = make_password_reset(db_session, coach_id=coach.id)
    db_session.commit()

    assert _close(client).status_code == 204

    assert db_session.get(PasswordReset, reset.id) is None


def test_closing_an_account_deletes_a_deleted_match_tombstone(
    client: TestClient, db_session: Session
) -> None:
    """The foreign key from deleted_matches has no ondelete either, so a tombstone left
    behind would refuse the delete outright (#214)."""
    coach = _closable(client, db_session)
    tombstone = make_deleted_match(db_session, coach_id=coach.id)
    db_session.commit()

    assert _close(client).status_code == 204

    assert db_session.get(DeletedMatch, tombstone.id) is None


def test_a_transfer_code_survives_the_delete_players_waiver(
    client: TestClient, db_session: Session
) -> None:
    """A live code is another coach's pending claim on the player (#173), so the waiver
    does not reach it: it is for a roster this coach owns outright, not a capability
    another coach may already be about to redeem. It used to reach the cascade unchecked
    and take a live code with it (b8c8c61); pinned so it stays refused.

    The waiver is what makes this the reachable case at all: without it the roster refusal
    answers first, since a code can only hang off a player still on the roster. The body is
    asserted exactly because the route declares the 409 as ErrorDetail.
    """
    coach = _closable(client, db_session)
    player = make_player(db_session, coach_id=coach.id)
    code = make_player_transfer_code(db_session, player_id=player.id)
    db_session.commit()

    response = _close(client, delete_players=True)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Outstanding transfer codes must be cancelled or redeemed first"
    }
    assert db_session.get(Coach, coach.id) is not None
    assert db_session.get(Player, player.id) is not None
    assert db_session.get(PlayerTransferCode, code.id) is not None


def test_the_email_can_sign_up_again_afterwards(client: TestClient, db_session: Session) -> None:
    """The erasure claim that matters for a coach asking to be removed: nothing of theirs
    is left holding the address, so the UNIQUE constraint no longer refuses it."""
    _closable(client, db_session, email="mike@example.com")

    assert _close(client).status_code == 204

    client.cookies.clear()
    verify_email(client, db_session, "mike@example.com")
    assert client.post("/coaches", json=SIGN_UP).status_code == 201


def test_closing_an_account_leaves_every_other_coach_untouched(
    client: TestClient, db_session: Session
) -> None:
    """The cascade is scoped by the session and nothing else. A bystander's player, match,
    session and deleted-match tombstone are exactly what a coach_id-wide delete would take
    with it."""
    _closable(client, db_session)
    bystander = make_coach(db_session)
    their_player = make_player(db_session, coach_id=bystander.id)
    their_match = make_match(db_session, player_id=their_player.id)
    their_session = make_coach_session(db_session, coach_id=bystander.id)
    their_tombstone = make_deleted_match(db_session, coach_id=bystander.id)
    db_session.commit()

    assert _close(client).status_code == 204

    assert db_session.get(Coach, bystander.id) is not None
    assert db_session.get(Player, their_player.id) is not None
    assert db_session.get(Match, their_match.id) is not None
    assert db_session.get(CoachSession, their_session.id) is not None
    assert db_session.get(DeletedMatch, their_tombstone.id) is not None


def test_a_wrong_password_erases_nothing(client: TestClient, db_session: Session) -> None:
    """The re-authentication itself: a session alone does not close an account. The body is
    asserted exactly because the route declares the 403 as ErrorDetail and the generated
    client is typed from that."""
    coach = _closable(client, db_session)
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = _close(client, password="not-the-password")

    assert response.status_code == 403
    assert response.json() == {"detail": "Incorrect password"}
    assert db_session.get(Coach, coach.id) is not None
    assert db_session.get(Player, player.id) is not None
    assert client.get("/coaches/me").status_code == 200


def test_a_closure_verified_before_a_password_write_erases_nothing(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A password write is how a coach ends a stolen session's access, so a closure whose
    proof predates it must not go through: the account would be erased by the credential
    that write retired, and nothing undoes it.

    The write is flushed from inside `verify_password`, where the other request's commit
    would land: one shared session cannot run two requests at once.
    """
    coach = _closable(client, db_session)
    real = verify_password

    def verify_then_write(password: str, password_hash: str) -> bool:
        verified = real(password, password_hash)
        coach.password_hash = hash_password("what-the-other-request-just-wrote")
        db_session.flush()
        return verified

    monkeypatch.setattr("matchpoint_api.routers.coaches.verify_password", verify_then_write)

    response = _close(client)

    assert response.status_code == 403
    assert response.json() == {"detail": "Incorrect password"}
    assert db_session.get(Coach, coach.id) is not None


def test_closing_an_account_needs_a_session(client: TestClient) -> None:
    """No session, no coach to re-authenticate: the 401 is current_coach's, which is
    exactly why a wrong password answers 403 instead."""
    response = _close(client)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_a_rejected_closure_echoes_no_password(client: TestClient, db_session: Session) -> None:
    """errors.py redacts `password` wherever it appears, this body included. A session is
    arranged because the dependency's 401 would otherwise answer before validation ran."""
    sign_in(client, db_session, make_coach(db_session))

    response = _close(client, password="x" * 129)

    assert response.status_code == 422
    assert "x" * 129 not in response.text


@pytest.mark.usefixtures("clock")
def test_wrong_guesses_beyond_the_coach_s_budget_are_refused(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The wrong-guess budget, at the burst create_app sizes (5). What it bounds is a
    stolen session hunting for the password, which is the only way this route can be
    guessed against, and here the prize is a delete nothing undoes."""
    _closable(client, db_session)
    _stub_out_verification(monkeypatch, answer=False)
    for _ in range(5):
        assert _close(client).status_code == 403

    response = _close(client)

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    # The per-coach tier's quote (30 s a token). It is the only tier with nothing left,
    # the arrival tiers being ten deep against six requests.
    assert int(response.headers["Retry-After"]) > 6


@pytest.mark.usefixtures("clock")
def test_a_correct_password_is_never_refused_by_the_coach_tier(
    client: TestClient, db_session: Session
) -> None:
    """Why the budget counts failures and not arrivals: even while someone guesses against
    a session they stole, the coach holding the real password can still close the account
    out from under them."""
    _closable(client, db_session)
    for _ in range(5):
        assert _close(client, password="wrong").status_code == 403
    assert _close(client, password="wrong").status_code == 429

    assert _close(client).status_code == 204


@pytest.mark.usefixtures("clock")
def test_closure_arrivals_beyond_the_address_burst_are_refused(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The arrival tier the route's Argon2 run needs, at the burst create_app sizes (10).
    Successes are what drain it, and successes are exactly what the wrong-guess tier
    deliberately never charges, so nothing else here bounds the hashing."""
    _stub_out_verification(monkeypatch, answer=True)
    for _ in range(10):
        _closable(client, db_session)
        assert _close(client).status_code == 204

    _closable(client, db_session)
    refused = _close(client)

    assert refused.status_code == 429
    assert refused.json() == {"detail": "Too many requests"}


def test_an_unauthenticated_flood_spends_none_of_the_closure_budget(
    client: TestClient, db_session: Session
) -> None:
    """Why the tiers are taken in the handler and not the decorator's dependencies: ahead
    of the session check, a stranger who can reach no hash at all would still drain the
    shared bucket and stand between every coach and this route."""
    for _ in range(20):
        assert _close(client).status_code == 401

    _closable(client, db_session)

    assert _close(client).status_code == 204


@pytest.mark.usefixtures("clock")
def test_closing_an_account_has_a_total_bound_no_address_escapes(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sign-up's shared-tier reasoning: behind Cloudflare the per-address key is an edge
    address an attacker can occupy many of. Two addresses drain the shared burst (10)
    without exhausting their own; a third is refused on its first request."""
    _stub_out_verification(monkeypatch, answer=True)
    for address in ("203.0.113.1", "203.0.113.2"):
        from_address = TestClient(
            client.app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS, client=(address, 50000)
        )
        for _ in range(5):
            _closable(from_address, db_session)
            assert _close(from_address).status_code == 204

    latecomer = TestClient(
        client.app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS, client=("203.0.113.3", 50000)
    )
    _closable(latecomer, db_session)

    assert _close(latecomer).status_code == 429


# --- Verifying the password: POST /coaches/me/verify-password ---


def _verify(client: TestClient, password: str = CLOSE_PASSWORD) -> httpx2.Response:
    return client.post("/coaches/me/verify-password", json={"password": password})


def test_the_right_password_verifies_and_leaves_the_account_alone(
    client: TestClient, db_session: Session
) -> None:
    """The whole endpoint: an answer about a password, and no state to show for it. The
    stored hash is asserted unchanged because login rehashes at its own verification and
    this route deliberately does not."""
    coach = _closable(client, db_session)
    stored = coach.password_hash

    response = _verify(client)

    assert response.status_code == 204
    assert response.content == b""
    assert db_session.get(Coach, coach.id) is not None
    assert coach.password_hash == stored
    assert client.get("/coaches/me").status_code == 200


def test_a_wrong_password_is_refused(client: TestClient, db_session: Session) -> None:
    """The point of the route: the closure's 403, one screen earlier. The body is asserted
    exactly because the route declares it as ErrorDetail for the form to show inline, and
    it reads identically to the closure's so a coach meets one refusal, not two."""
    _closable(client, db_session)

    response = _verify(client, password="not-the-password")

    assert response.status_code == 403
    assert response.json() == {"detail": "Incorrect password"}


def test_verifying_needs_a_session(client: TestClient) -> None:
    """There is no password to check without a coach to check it against: the 401 is
    current_coach's, which is why a wrong password answers 403 instead."""
    response = _verify(client)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_a_rejected_verification_echoes_no_password(
    client: TestClient, db_session: Session
) -> None:
    """errors.py redacts `password` wherever it appears, this body included. A session is
    arranged because the dependency's 401 would otherwise answer before validation ran."""
    sign_in(client, db_session, make_coach(db_session))

    response = _verify(client, password="x" * 129)

    assert response.status_code == 422
    assert "x" * 129 not in response.text


@pytest.mark.usefixtures("clock")
def test_wrong_guesses_here_spend_the_closure_s_budget(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Why this route takes the closure's tiers rather than its own: the two are one
    flow's two steps, so a stolen session gets five wrong guesses at the password in
    total (burst 5), not five on each screen that asks for it."""
    _closable(client, db_session)
    _stub_out_verification(monkeypatch, answer=False)
    for _ in range(5):
        assert _verify(client, password="wrong").status_code == 403

    refused = _verify(client, password="wrong")

    assert refused.status_code == 429
    # The per-coach tier's quote (30 s a token), which is what says the shared budget is
    # the tier that refused: the arrival tiers are ten deep against six requests.
    assert int(refused.headers["Retry-After"]) > 6
    assert _close(client, password="wrong").status_code == 429


@pytest.mark.usefixtures("clock")
def test_a_correct_password_still_verifies_while_someone_guesses(
    client: TestClient, db_session: Session
) -> None:
    """The other half of the closure's budget carried over: the coach holding the real
    password still gets their answer while someone else is guessing at it."""
    _closable(client, db_session)
    for _ in range(5):
        assert _verify(client, password="wrong").status_code == 403
    assert _verify(client, password="wrong").status_code == 429

    assert _verify(client).status_code == 204


@pytest.mark.usefixtures("clock")
def test_verifications_and_closures_share_one_arrival_budget(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The arrival tier this route's Argon2 run needs, shared with the closure for the
    wrong-guess budget's reason: correct passwords are what drain it, and the wrong-guess
    tier deliberately never charges those, so nothing else here bounds the hashing."""
    _closable(client, db_session)
    _stub_out_verification(monkeypatch, answer=True)
    for _ in range(10):
        assert _verify(client).status_code == 204

    refused = _close(client)

    assert refused.status_code == 429
    assert refused.json() == {"detail": "Too many requests"}


def test_an_unauthenticated_flood_spends_none_of_that_budget(
    client: TestClient, db_session: Session
) -> None:
    """Why the tiers are taken in the handler and not the decorator's dependencies: ahead
    of the session check, a stranger who can reach no hash at all would drain the shared
    bucket and stand between every coach and their own account closure."""
    for _ in range(20):
        assert _verify(client).status_code == 401

    _closable(client, db_session)

    assert _verify(client).status_code == 204


def test_coaches_are_not_listable(client: TestClient) -> None:
    """No list route on purpose: it would be an unauthenticated dump of every coach's
    email address. Pinned so that adding one is a deliberate act, taken together with
    whatever authenticates the caller.

    405 rather than 404 now that sign-up POSTs to this same path: the route matches and
    the method is what is missing. Either status proves the absence — which one it is just
    depends on whether anything else answers on the path.
    """
    response = client.get("/coaches")

    assert response.status_code == 405
