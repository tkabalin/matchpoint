import logging
import re
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from argon2 import PasswordHasher
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.auth import (
    OTP_ATTEMPT_LIMIT,
    OTP_LIFETIME,
    SESSION_COOKIE,
    SESSION_LIFETIME,
    VERIFICATION_COOKIE,
    VERIFICATION_LIFETIME,
    hash_otp,
    hash_token,
    new_session_token,
)
from matchpoint_api.mail import EmailSendError
from matchpoint_api.models import Coach, CoachSession, EmailVerification
from matchpoint_api.routers.auth import SEND_FAILED
from matchpoint_api.security import DUMMY_HASH, hash_password
from tests.factories import make_coach, make_coach_session, make_email_verification

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


def test_an_arrival_beyond_the_address_burst_spends_no_verification(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The claim the arrival tiers exist for: once they refuse, an attempt costs no
    Argon2 run. Only their placement in `dependencies` puts them ahead of the handler,
    and no other test would notice them sliding into it — so the calls are counted, not
    just the status. The per-account tier makes the opposite promise deliberately, and
    pays a verification per refusal to keep it."""
    calls: list[str] = []
    monkeypatch.setattr(
        "matchpoint_api.routers.auth.verify_password",
        lambda password, password_hash: (calls.append(password), False)[1],
    )
    for n in range(20):
        assert client.post("/auth/login", json=LOGIN | {"email": f"c{n}@x.com"}).status_code == 401

    refused = client.post("/auth/login", json=LOGIN)

    assert refused.status_code == 429
    assert len(calls) == 20


def test_a_correct_password_is_never_refused_by_the_account_tier(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What keeps a per-account bound from being an account-lockout lever. Only a failed
    verification is charged, so a flood against a known address — and sign-up's 409 hands
    those out — drains the bucket without ever standing between the coach and their own
    account. Counting arrivals instead, one request every thirty seconds would have taken
    each token as it refilled and kept them signed out for good.

    The stub answers the real password and refuses the rest, so both branches of the
    handler run for real; what it saves is thirty Argon2 runs, not the logic."""
    _sign_up(client)
    monkeypatch.setattr(
        "matchpoint_api.routers.auth.verify_password",
        lambda password, password_hash: password == LOGIN["password"],
    )
    for _ in range(5):
        assert client.post("/auth/login", json=LOGIN | {"password": "wrong"}).status_code == 401
    assert client.post("/auth/login", json=LOGIN | {"password": "wrong"}).status_code == 429

    response = client.post("/auth/login", json=LOGIN)

    assert response.status_code == 200
    assert "set-cookie" in response.headers


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


# --- Sign-up email verification: /auth/request-otp and /auth/verify-otp ---

PENDING_EMAIL = "new@example.com"


class RecordingEmailSender:
    """Swapped in over the app's sender: the same seam the routes use, but the test
    can read what was handed to it — and nothing can reach the wire either way."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    def send(self, *, to: str, subject: str, text: str) -> None:
        self.sent.append((to, subject, text))


def _record_email(client: TestClient) -> RecordingEmailSender:
    recorder = RecordingEmailSender()
    cast(FastAPI, client.app).state.email_sender = recorder
    return recorder


def _code_in(body: str) -> str:
    match = re.search(r"\b\d{6}\b", body)
    assert match, f"no six-digit code in {body!r}"
    return match.group()


def _request_otp(client: TestClient, email: str = PENDING_EMAIL) -> str:
    """Run the request step and hand back the code that was 'emailed'."""
    recorder = _record_email(client)
    assert client.post("/auth/request-otp", json={"email": email}).status_code == 202
    return _code_in(recorder.sent[-1][2])


def _wrong_guess_for(code: str) -> str:
    return "000000" if code != "000000" else "111111"


def test_requesting_a_code_emails_it_to_the_address(client: TestClient) -> None:
    recorder = _record_email(client)

    response = client.post("/auth/request-otp", json={"email": PENDING_EMAIL})

    assert response.status_code == 202
    [(to, subject, body)] = recorder.sent
    assert to == PENDING_EMAIL
    assert "code" in subject.lower()
    assert _code_in(body)


def test_a_failed_send_answers_502(client: TestClient, db_session: Session) -> None:
    """The reason the send is inline rather than deferred: a coach must not be sent to the
    code-entry screen to wait for mail the provider never accepted.

    The row survives it. Nothing needs to roll back — it expires on its own, and the retry
    this 502 is asking for overwrites it — and undoing the commit to make the failure tidy
    would mean the successful path had to hold the transaction open across a network call.
    """

    class FailingEmailSender:
        def send(self, *, to: str, subject: str, text: str) -> None:
            raise EmailSendError("provider said no")

    cast(FastAPI, client.app).state.email_sender = FailingEmailSender()

    response = client.post("/auth/request-otp", json={"email": PENDING_EMAIL})

    assert response.status_code == 502
    assert response.json()["detail"] == SEND_FAILED
    assert db_session.scalars(select(EmailVerification)).one().email == PENDING_EMAIL


def test_a_failed_send_gives_the_address_its_code_budget_back(client: TestClient) -> None:
    """Otherwise the 502's "please try again" is advice the next request cannot take: the
    per-email tier holds three tokens, and a provider having a bad minute would spend all
    three on emails nobody received, then refuse the fourth attempt for five minutes."""

    class FailingEmailSender:
        def send(self, *, to: str, subject: str, text: str) -> None:
            raise EmailSendError("provider said no")

    cast(FastAPI, client.app).state.email_sender = FailingEmailSender()
    for _ in range(3):
        assert client.post("/auth/request-otp", json={"email": PENDING_EMAIL}).status_code == 502

    recorder = _record_email(client)
    response = client.post("/auth/request-otp", json={"email": PENDING_EMAIL})

    assert response.status_code == 202
    assert len(recorder.sent) == 1


def test_the_code_is_stored_hashed_and_expiring(client: TestClient, db_session: Session) -> None:
    """The row must let a submitted code be checked without letting a copy of the
    table read codes back out — and it must die on its own, emailed or not."""
    code = _request_otp(client)

    row = db_session.scalars(select(EmailVerification)).one()
    assert row.email == PENDING_EMAIL
    assert row.otp_hash == hash_otp(code)
    assert code not in hash_otp(code)
    assert row.token_hash is None
    assert row.attempts == 0
    assert timedelta() < row.expires_at - datetime.now(UTC) <= OTP_LIFETIME


def test_a_registered_address_is_refused_with_no_code(
    client: TestClient, db_session: Session
) -> None:
    """The 409 the shipped sign-up form branches on. Nothing is stored and nothing is
    sent: a registered address has no business receiving sign-up codes."""
    _sign_up(client)
    recorder = _record_email(client)

    response = client.post("/auth/request-otp", json={"email": "mike@example.com"})

    assert response.status_code == 409
    assert response.json() == {"detail": "Email already registered"}
    assert recorder.sent == []
    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 0


def test_a_mixed_case_address_meets_the_409(client: TestClient) -> None:
    """Coach rows are stored lowercased, so only a folded lookup can find mike@ when
    MIKE@ asks for a code — anything else would mail sign-up codes to taken addresses."""
    _sign_up(client)

    response = client.post("/auth/request-otp", json={"email": "MIKE@Example.COM"})

    assert response.status_code == 409


def test_the_stored_address_is_lowercased(client: TestClient, db_session: Session) -> None:
    """The row's email is what the verification cookie will later be matched against
    (#44), and coaches.email is lowercased — so this column must fold the same way."""
    recorder = _record_email(client)

    client.post("/auth/request-otp", json={"email": "New@Example.COM"})

    row = db_session.scalars(select(EmailVerification)).one()
    assert row.email == PENDING_EMAIL
    assert recorder.sent[-1][0] == PENDING_EMAIL


def test_requesting_again_replaces_the_code(client: TestClient, db_session: Session) -> None:
    """One live code per address, always: a resend must replace the old code rather
    than mint a second concurrently-valid one, or every resend would widen the
    guessing surface and leave 'which code works?' ambiguous."""
    first = _request_otp(client)
    second = _request_otp(client)

    row = db_session.scalars(select(EmailVerification)).one()
    assert row.otp_hash == hash_otp(second)

    stale = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": first})
    assert stale.status_code == 400
    fresh = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": second})
    assert fresh.status_code == 200


def test_requesting_a_code_undoes_a_finished_verification(
    client: TestClient, db_session: Session
) -> None:
    """Asking for a code resets the address to unproven, even one that already answered:
    the row goes back to the code stage and the cookie it issued stops matching. The
    alternative — refusing the request — would strand a coach who lost the cookie."""
    code = _request_otp(client)
    answered = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})
    assert answered.status_code == 200

    _request_otp(client)

    row = db_session.scalars(select(EmailVerification)).one()
    assert row.otp_hash is not None
    # Nothing left for the issued cookie to match, which is the cost being accepted.
    assert row.token_hash is None


def test_requesting_sweeps_expired_rows_and_leaves_live_ones(
    client: TestClient, db_session: Session
) -> None:
    """The cleanup this table gets instead of a cron job: expired rows die on the next
    request, whoever's they were — bounding the table to addresses seen within an
    expiry window. Live rows are someone's pending sign-up and must survive."""
    expired = make_email_verification(
        db_session,
        email="abandoned@example.com",
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    live = make_email_verification(db_session, email="pending@example.com")
    db_session.commit()

    _request_otp(client)

    assert db_session.get(EmailVerification, expired.id) is None
    assert db_session.get(EmailVerification, live.id) is not None


def test_a_fourth_code_for_one_address_is_refused(client: TestClient) -> None:
    """The per-email tier, and it is security rather than politeness: five attempts
    per code bounds nothing if codes can be minted without bound. The quoted wait is
    the per-email tier's own (a token every five minutes), and the refused request
    sends no email."""
    recorder = _record_email(client)
    for _ in range(3):
        assert client.post("/auth/request-otp", json={"email": PENDING_EMAIL}).status_code == 202

    response = client.post("/auth/request-otp", json={"email": PENDING_EMAIL})

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}
    assert int(response.headers["Retry-After"]) > 60
    assert len(recorder.sent) == 3


def test_the_code_budget_folds_case(client: TestClient) -> None:
    _record_email(client)
    for email in ("new@example.com", "NEW@example.com", "New@Example.COM"):
        assert client.post("/auth/request-otp", json={"email": email}).status_code == 202

    assert client.post("/auth/request-otp", json={"email": PENDING_EMAIL}).status_code == 429


def test_cycling_addresses_meets_the_address_burst(client: TestClient) -> None:
    """Per-email alone would hand out three free sends per invented address; the
    per-address and shared tiers bound the arrivals themselves, at sign-up's sizes."""
    _record_email(client)
    for n in range(10):
        response = client.post("/auth/request-otp", json={"email": f"new{n}@example.com"})
        assert response.status_code == 202

    assert client.post("/auth/request-otp", json={"email": "new10@example.com"}).status_code == 429


def test_request_otp_has_a_total_bound_no_address_escapes(client: TestClient) -> None:
    """Behind Cloudflare the per-address key is an edge address an attacker can occupy
    many of; only the shared bucket bounds what gets mailed in total — and what a young
    sending domain's reputation is exposed to."""
    _record_email(client)
    from_elsewhere = TestClient(client.app, client=("203.0.113.1", 50000))
    for n in range(10):
        body = {"email": f"new-{n}@example.com"}
        assert from_elsewhere.post("/auth/request-otp", json=body).status_code == 202

    latecomer = TestClient(client.app, client=("203.0.113.2", 50000))

    response = latecomer.post("/auth/request-otp", json={"email": "late@example.com"})
    assert response.status_code == 429


def test_answering_the_code_sets_the_verification_cookie(client: TestClient) -> None:
    """The cookie is the endpoint's product: proof this browser answered a code sent
    to that address, for the sign-up call to demand (#44)."""
    code = _request_otp(client)

    response = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})

    assert response.status_code == 200
    assert client.cookies.get(VERIFICATION_COOKIE)


def test_the_verification_cookie_is_locked_down(client: TestClient) -> None:
    """test_the_cookie_is_locked_down's reasoning, for the second cookie: the flags
    are the design, the `__Host-` prefix is what they earn, and the name must never
    collide with the session's — this cookie proves a lesser fact."""
    code = _request_otp(client)

    header = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code}).headers[
        "set-cookie"
    ]

    assert VERIFICATION_COOKIE == "__Host-matchpoint_email_verification"
    assert VERIFICATION_COOKIE != SESSION_COOKIE
    assert header.startswith(f"{VERIFICATION_COOKIE}=")
    assert "httponly" in header.lower()
    assert "secure" in header.lower()
    assert "path=/" in header.lower()
    assert "domain=" not in header.lower()
    assert "samesite=lax" in header.lower()
    assert f"max-age={int(VERIFICATION_LIFETIME.total_seconds())}" in header.lower()


def test_answering_the_code_retires_it_for_the_token(
    client: TestClient, db_session: Session
) -> None:
    """The row's one transition, in one UPDATE: the code dies the instant it works,
    the stored value is the token's hash and never the token, and the deadline is
    rewritten to the verification's own — not extended for free."""
    code = _request_otp(client)

    client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})

    row = db_session.scalars(select(EmailVerification)).one()
    token = client.cookies[VERIFICATION_COOKIE]
    assert row.otp_hash is None
    assert row.token_hash == hash_token(token)
    assert token not in hash_token(token)
    assert row.attempts == 0
    assert timedelta() < row.expires_at - datetime.now(UTC) <= VERIFICATION_LIFETIME


def test_a_wrong_code_is_refused_and_charged(client: TestClient, db_session: Session) -> None:
    code = _request_otp(client)

    response = client.post(
        "/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": _wrong_guess_for(code)}
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Incorrect or expired code"}
    assert "set-cookie" not in response.headers
    # The charge outlives the refusal — committed, not rolled back with the 400.
    row = db_session.scalars(select(EmailVerification)).one()
    assert row.attempts == 1


def test_an_unknown_address_answers_exactly_like_a_wrong_code(client: TestClient) -> None:
    """One 400 for every failure: wrong, expired, exhausted and never-asked are one
    fact to the caller, and distinguishing them would tell a prober which addresses
    are mid-sign-up."""
    code = _request_otp(client)

    unknown = client.post("/auth/verify-otp", json={"email": "ghost@example.com", "otp": code})
    wrong = client.post(
        "/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": _wrong_guess_for(code)}
    )

    assert unknown.status_code == wrong.status_code == 400
    assert unknown.json() == wrong.json()


def test_an_expired_code_is_refused(client: TestClient, db_session: Session) -> None:
    make_email_verification(
        db_session,
        email=PENDING_EMAIL,
        otp_hash=hash_otp("123456"),
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    db_session.commit()

    response = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": "123456"})

    assert response.status_code == 400
    assert "set-cookie" not in response.headers


def test_an_answered_code_cannot_be_answered_again(client: TestClient) -> None:
    """Single-use: once traded for the cookie, the code is gone — a replay of a
    leaked, already-used code must win nothing."""
    code = _request_otp(client)
    answered = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})
    assert answered.status_code == 200

    replay = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})

    assert replay.status_code == 400


def test_verification_folds_the_address_case(client: TestClient) -> None:
    code = _request_otp(client)

    response = client.post("/auth/verify-otp", json={"email": "NEW@Example.COM", "otp": code})

    assert response.status_code == 200


def test_the_attempt_budget_kills_the_code(client: TestClient, db_session: Session) -> None:
    """The actual bound on guessing (the digest is not one — auth.py's hash_otp):
    five wrong answers and the row dies, so even the right code wins nothing after.
    Counted in the database, where a deploy cannot refill it."""
    code = _request_otp(client)
    for _ in range(OTP_ATTEMPT_LIMIT):
        wrong = client.post(
            "/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": _wrong_guess_for(code)}
        )
        assert wrong.status_code == 400

    assert db_session.scalar(select(func.count()).select_from(EmailVerification)) == 0
    response = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})
    assert response.status_code == 400


def test_a_guess_short_of_the_budget_does_not_cost_the_code(client: TestClient) -> None:
    """The budget is five, not fewer: a coach who fat-fingers the code four times is
    exactly who the cap must not lock out."""
    code = _request_otp(client)
    wrong = _wrong_guess_for(code)
    for _ in range(OTP_ATTEMPT_LIMIT - 1):
        client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": wrong})

    response = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})

    assert response.status_code == 200


def test_guess_arrivals_beyond_the_address_burst_are_refused(client: TestClient) -> None:
    """The second layer behind the attempt budget: arrivals themselves stay bounded,
    as every unauthenticated endpoint's are. Guesses at addresses holding no row cost
    the attacker arrivals all the same."""
    for n in range(10):
        response = client.post(
            "/auth/verify-otp", json={"email": f"ghost{n}@example.com", "otp": "123456"}
        )
        assert response.status_code == 400

    refused = client.post("/auth/verify-otp", json={"email": "ghost@example.com", "otp": "123456"})

    assert refused.status_code == 429
    assert refused.json() == {"detail": "Too many requests"}


def test_a_rejected_verification_does_not_echo_the_code(client: TestClient) -> None:
    """The 422 redaction, for the second secret the schemas carry: a code of the
    wrong length must not come back in detail[].input."""
    response = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": "1234567"})

    assert response.status_code == 422
    assert "1234567" not in response.text


def test_the_flow_runs_on_the_default_logging_sender(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """No recorder: this is create_app's own wiring, end to end. The logging sender is
    the seam's default, so the code lands in the log — which in local dev is exactly
    where you go to read it — and the flow it 'sent' completes against the real row."""
    with caplog.at_level(logging.INFO, logger="matchpoint_api.mail"):
        assert client.post("/auth/request-otp", json={"email": PENDING_EMAIL}).status_code == 202
    code = _code_in(caplog.text)

    response = client.post("/auth/verify-otp", json={"email": PENDING_EMAIL, "otp": code})

    assert response.status_code == 200
