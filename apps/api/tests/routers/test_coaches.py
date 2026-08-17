import uuid
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from psycopg.errors import CheckViolation
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from matchpoint_api.auth import (
    SESSION_COOKIE,
    SESSION_LIFETIME,
    VERIFICATION_COOKIE,
    CurrentCoach,
    hash_token,
    new_session_token,
)
from matchpoint_api.db import get_db
from matchpoint_api.main import create_app
from matchpoint_api.models import Coach, CoachSession, EmailVerification
from matchpoint_api.security import verify_password
from tests.conftest import ORIGIN_HEADERS, TEST_ORIGIN
from tests.factories import make_coach, make_coach_session, sign_in, verify_email

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
