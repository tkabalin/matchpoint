from datetime import UTC, datetime, timedelta

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.auth import SESSION_COOKIE, SESSION_LIFETIME, hash_token, new_session_token
from matchpoint_api.models import Coach, CoachSession
from matchpoint_api.security import DUMMY_HASH, hash_password
from tests.factories import make_coach, make_coach_session

SIGN_UP = {
    "email": "mike@example.com",
    "display_name": "Coach Mike",
    "password": "a-good-password",
}
LOGIN = {"email": "mike@example.com", "password": "a-good-password"}


def _sign_up(client: TestClient) -> None:
    assert client.post("/coaches", json=SIGN_UP).status_code == 201


def test_logging_in_returns_the_coach_and_sets_the_session_cookie(client: TestClient) -> None:
    _sign_up(client)

    response = client.post("/auth/login", json=LOGIN)

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "mike@example.com"
    assert body["display_name"] == "Coach Mike"
    assert "password_hash" not in body
    assert client.cookies.get(SESSION_COOKIE)


def test_the_cookie_is_locked_down(client: TestClient) -> None:
    """The flags are the design: HttpOnly is what keeps the token away from script,
    Secure keeps it off plain http, SameSite=Lax is the CSRF line, and Max-Age is the
    lifetime auth.py promises. None is separable from 'set a cookie'.

    The name is part of it too. `__Host-` is what stops a sibling subdomain of the apex
    we share from setting a Domain-scoped cookie of the same name for the browser to send
    alongside ours, and a browser only honours the prefix on a cookie that is Secure,
    Path=/ and carries no Domain — so the three are asserted with it rather than apart.
    """
    _sign_up(client)

    header = client.post("/auth/login", json=LOGIN).headers["set-cookie"]

    assert SESSION_COOKIE == "__Host-matchpoint_session"
    assert header.startswith(f"{SESSION_COOKIE}=")
    assert "httponly" in header.lower()
    assert "secure" in header.lower()
    assert "path=/" in header.lower()
    assert "domain=" not in header.lower()
    assert "samesite=lax" in header.lower()
    assert f"max-age={int(SESSION_LIFETIME.total_seconds())}" in header.lower()


def test_logging_in_stores_the_hash_of_the_token_and_never_the_token(
    client: TestClient, db_session: Session
) -> None:
    """The row must let a presented token authenticate without letting a copy of the
    table do the same, which is exactly 'stores the SHA-256, not the value'."""
    _sign_up(client)
    client.post("/auth/login", json=LOGIN)
    token = client.cookies[SESSION_COOKIE]

    session_row = db_session.scalars(select(CoachSession)).one()
    assert session_row.token_hash == hash_token(token)
    assert session_row.token_hash != token
    assert token not in session_row.token_hash


def test_a_login_expires_a_lifetime_from_now(client: TestClient, db_session: Session) -> None:
    _sign_up(client)

    client.post("/auth/login", json=LOGIN)

    session_row = db_session.scalars(select(CoachSession)).one()
    assert session_row.expires_at - session_row.created_at >= SESSION_LIFETIME * 0.99


def test_each_login_is_its_own_session(client: TestClient, db_session: Session) -> None:
    """Two devices, two rows: logging in on the phone must not sign out the laptop,
    and logging out one must be able to leave the other alive."""
    _sign_up(client)

    client.post("/auth/login", json=LOGIN)
    client.post("/auth/login", json=LOGIN)

    assert db_session.scalar(select(func.count()).select_from(CoachSession)) == 2


def test_logging_in_clears_the_coach_s_expired_sessions(
    client: TestClient, db_session: Session
) -> None:
    """A session nobody presents again is a row nothing would otherwise delete. Signing
    in is the one moment this coach's dead rows are cheap to find — the foreign key's
    index is already the lookup — so the login that would add to the pile clears it."""
    _sign_up(client)
    coach = db_session.scalars(select(Coach).where(Coach.email == "mike@example.com")).one()
    make_coach_session(
        db_session, coach_id=coach.id, expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    db_session.commit()

    client.post("/auth/login", json=LOGIN)

    # Exactly one row, and it is the live one: the expired session went, the new one came.
    remaining = db_session.scalars(select(CoachSession)).one()
    assert remaining.expires_at > datetime.now(UTC)


def test_logging_in_leaves_other_coaches_expired_sessions_alone(
    client: TestClient, db_session: Session
) -> None:
    """Scoped to the coach signing in. Widening it to every expired row would put a
    whole-table delete on the login path to do one coach's worth of work."""
    _sign_up(client)
    other_coach = make_coach(db_session)
    other_session = make_coach_session(
        db_session, coach_id=other_coach.id, expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    db_session.commit()

    client.post("/auth/login", json=LOGIN)

    assert db_session.get(CoachSession, other_session.id) is not None


def test_a_wrong_password_is_rejected_without_a_session(
    client: TestClient, db_session: Session
) -> None:
    _sign_up(client)

    response = client.post("/auth/login", json=LOGIN | {"password": "the-wrong-password"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect email or password"}
    assert "set-cookie" not in response.headers
    assert db_session.scalar(select(func.count()).select_from(CoachSession)) == 0


def test_an_unknown_email_answers_exactly_like_a_wrong_password(client: TestClient) -> None:
    """The response half of the enumeration defence: status and body identical, so
    nothing in what comes back says whether the address has an account."""
    _sign_up(client)

    unknown_email = client.post("/auth/login", json=LOGIN | {"email": "ghost@example.com"})
    wrong_password = client.post("/auth/login", json=LOGIN | {"password": "the-wrong-password"})

    assert unknown_email.status_code == wrong_password.status_code == 401
    assert unknown_email.json() == wrong_password.json()


def test_an_unknown_email_still_burns_a_verification(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The timing half: an unknown address must cost the Argon2 run a known one costs,
    or response time answers what the body refuses to. Pinned by spying on the route's
    verify_password rather than by a stopwatch, which would flake — what matters is
    that exactly one verification happens and that it is against DUMMY_HASH, whose
    parameters (and so cost) match a real row's."""
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "matchpoint_api.routers.auth.verify_password",
        lambda password, password_hash: (calls.append((password, password_hash)), False)[1],
    )

    response = client.post("/auth/login", json=LOGIN | {"email": "ghost@example.com"})

    assert response.status_code == 401
    assert calls == [("a-good-password", DUMMY_HASH)]


def test_a_mixed_case_email_finds_the_account(client: TestClient) -> None:
    """Rows are stored lowercased and EmailStr folds only the domain, so the route's
    lower() is what lets a coach who signs in as MIKE@ find mike@'s row."""
    _sign_up(client)

    assert client.post("/auth/login", json=LOGIN | {"email": "MIKE@Example.COM"}).status_code == 200


def test_a_password_below_the_sign_up_floor_is_a_401_not_a_422(client: TestClient) -> None:
    """LoginRequest deliberately has no min_length: the floor is sign-up policy for new
    passwords, and raising it later must not lock out coaches enrolled under the old
    one. A short password is simply wrong, not malformed."""
    _sign_up(client)

    response = client.post("/auth/login", json=LOGIN | {"password": "x"})

    assert response.status_code == 401


def test_a_stale_hash_is_upgraded_on_login(client: TestClient, db_session: Session) -> None:
    """The one moment the plaintext and a database session are both in hand: a row
    hashed under old parameters logs in fine and comes out re-hashed under the current
    ones, still verifying — this is how a parameter change in security.py reaches rows
    that predate it."""
    stale_hash = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("a-good-password")
    coach = make_coach(db_session, email="mike@example.com", password_hash=stale_hash)
    db_session.commit()

    response = client.post("/auth/login", json=LOGIN)

    assert response.status_code == 200
    refreshed = db_session.get(Coach, coach.id)
    assert refreshed is not None
    assert refreshed.password_hash != stale_hash
    assert "m=65536,t=3,p=1" in refreshed.password_hash


def test_a_current_hash_is_left_alone_on_login(client: TestClient, db_session: Session) -> None:
    """The mirror case: re-hashing on every login would double the Argon2 bill per
    sign-in and churn the column for nothing."""
    current_hash = hash_password("a-good-password")
    coach = make_coach(db_session, email="mike@example.com", password_hash=current_hash)
    db_session.commit()

    assert client.post("/auth/login", json=LOGIN).status_code == 200

    refreshed = db_session.get(Coach, coach.id)
    assert refreshed is not None
    assert refreshed.password_hash == current_hash


def _stub_out_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail every verification without running Argon2. These tests need volume, not real
    hashing, and a failed verification is what the per-account tier counts — so stubbing
    charges every bucket exactly as a wrong password would and keeps ~40 attempts cheap."""
    monkeypatch.setattr("matchpoint_api.routers.auth.verify_password", lambda *_: False)


def test_login_attempts_beyond_the_account_burst_are_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The per-account bound #26 exists for, pinned at the burst create_app sizes (5).

    No account is ever created: the bucket keys on the submitted address whether or not
    a row lives there, so the 429 arrives all the same — and discloses nothing about
    which addresses hold accounts. The body is asserted exactly because the route
    declares the 429 as ErrorDetail and the generated client is typed from that.
    """
    _stub_out_verification(monkeypatch)
    for _ in range(5):
        assert client.post("/auth/login", json=LOGIN).status_code == 401

    response = client.post("/auth/login", json=LOGIN)

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    # The per-account tier's quote (30 s a token). It is the only tier with nothing
    # left, the others being twenty deep — but even drained alongside them it is the
    # one `take_all` would name, as the furthest of the three from a token.
    assert int(response.headers["Retry-After"]) > 6


def test_a_flooded_account_does_not_lock_out_the_rest(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The point of keying on the account: the bucket a flood aimed at mike@ drains is
    mike@'s own, so every other coach still signs in — even one behind the very same
    address. The flood's arrivals do count against the shared tiers, as any arrival
    costing a verification must, but twenty deep those are nowhere near refusing."""
    _stub_out_verification(monkeypatch)
    for _ in range(8):
        client.post("/auth/login", json=LOGIN)
    assert client.post("/auth/login", json=LOGIN).status_code == 429

    other_account = client.post("/auth/login", json=LOGIN | {"email": "other@example.com"})

    assert other_account.status_code == 401


def test_the_account_bucket_folds_case(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The bucket key folds the whole address the way the row lookup does — otherwise
    every casing of MIKE@ would mint a fresh bucket and the per-account bound would
    be no bound at all."""
    _stub_out_verification(monkeypatch)
    for _ in range(5):
        assert (
            client.post("/auth/login", json=LOGIN | {"email": "MIKE@Example.COM"}).status_code
            == 401
        )

    assert client.post("/auth/login", json=LOGIN).status_code == 429


def test_cycling_accounts_does_not_escape_the_address_burst(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Per-account alone would hand an attacker five free tries per invented address;
    the per-address and shared tiers are what bound the arrivals themselves, at the
    burst create_app sizes for login (20)."""
    _stub_out_verification(monkeypatch)
    for n in range(20):
        attempt = client.post("/auth/login", json=LOGIN | {"email": f"coach{n}@example.com"})
        assert attempt.status_code == 401

    twenty_first = client.post("/auth/login", json=LOGIN | {"email": "coach20@example.com"})

    assert twenty_first.status_code == 429


def test_login_has_a_total_bound_no_address_escapes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sign-up's shared-tier reasoning holds here too: behind Cloudflare the per-address
    key is an edge address an attacker can occupy many of, so a spread-out guessing run
    must still hit a ceiling. Every attempt names a different account, so only the
    shared bucket can be what refuses the latecomer."""
    _stub_out_verification(monkeypatch)
    for address in ("203.0.113.1", "203.0.113.2"):
        from_address = TestClient(client.app, client=(address, 50000))
        for n in range(10):
            body = LOGIN | {"email": f"coach-{address}-{n}@example.com"}
            assert from_address.post("/auth/login", json=body).status_code == 401

    latecomer = TestClient(client.app, client=("203.0.113.3", 50000))

    assert (
        latecomer.post("/auth/login", json=LOGIN | {"email": "late@example.com"}).status_code == 429
    )


def test_a_body_the_schema_rejects_is_still_counted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sign-up's counting, not an inverse of it: the arrival tiers run in the decorator's
    dependencies, ahead of validation, so a body the schema rejects is metered for the
    worker thread it spent getting rejected. The valid body at the end is what shows the
    tokens really went — it is refused without its password ever being read."""
    _stub_out_verification(monkeypatch)
    for _ in range(20):
        assert client.post("/auth/login", json={}).status_code == 422

    assert client.post("/auth/login", json=LOGIN).status_code == 429


def test_logging_out_revokes_the_session_and_clears_the_cookie(
    client: TestClient, db_session: Session
) -> None:
    _sign_up(client)
    client.post("/auth/login", json=LOGIN)

    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(CoachSession)) == 0
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert not client.cookies.get(SESSION_COOKIE)


def test_logging_out_only_ends_the_presented_session(
    client: TestClient, db_session: Session
) -> None:
    """Logout revokes the one login it was sent from; the coach's other devices keep
    their rows and stay signed in."""
    _sign_up(client)
    client.post("/auth/login", json=LOGIN)
    other_device_token = client.cookies[SESSION_COOKIE]
    client.cookies.clear()
    client.post("/auth/login", json=LOGIN)

    client.post("/auth/logout")

    remaining = db_session.scalars(select(CoachSession)).one()
    assert remaining.token_hash == hash_token(other_device_token)


def test_logging_out_signed_out_is_still_a_204(client: TestClient) -> None:
    """Idempotent on purpose: 'signed out' is a state, and a retry or double-click
    reaching it twice is a success, not an error."""
    assert client.post("/auth/logout").status_code == 204


def test_logging_out_with_a_forged_cookie_revokes_nothing(
    client: TestClient, db_session: Session
) -> None:
    """The no-cookie case above shares the early return; a cookie that hashes to no row
    walks the delete instead, so it is the one that must be seen to delete *nothing* —
    a forged token reaching someone else's session row would be revocation as a service.
    The 204 and the cleared cookie are the same statelessness the other logouts promise."""
    _sign_up(client)
    client.post("/auth/login", json=LOGIN)
    client.cookies.set(SESSION_COOKIE, new_session_token())

    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(CoachSession)) == 1
    # The header rather than the client's jar: a hand-set cookie has a different jar
    # identity than the server's, so the jar keeps it even as a browser would not.
    assert "max-age=0" in response.headers["set-cookie"].lower()


def test_a_rejected_login_does_not_echo_the_password(client: TestClient) -> None:
    """The app-wide 422 redaction, seen through the login route: a password long
    enough to trip the ceiling must not come back in detail[].input."""
    response = client.post("/auth/login", json=LOGIN | {"password": "hunter2" * 20})

    assert response.status_code == 422
    assert "hunter2" not in response.text
