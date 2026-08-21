from datetime import UTC, datetime, timedelta

import httpx2
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, select
from sqlalchemy.orm import Session

from matchpoint_api.auth import (
    PLAYER_SESSION_COOKIE,
    SESSION_COOKIE,
    SESSION_LIFETIME,
    hash_token,
    new_session_token,
)
from matchpoint_api.models import CoachSession, Player, PlayerSession
from matchpoint_api.security import DUMMY_HASH, hash_password, verify_password
from tests.conftest import ORIGIN_HEADERS, TEST_ORIGIN, breach_every_password
from tests.factories import (
    make_coach,
    make_player,
    make_player_session,
    sign_in,
    sign_in_player,
)

PLAYER_PASSWORD = "abcd-efgh-jkmn"
# Hashed once for the whole module: a real Argon2 run per test would put most of the
# file's runtime into arranging rows that are not what any of these tests are about.
PLAYER_HASH = hash_password(PLAYER_PASSWORD)
PLAYER_LOGIN = {"username": "kbltho001", "password": PLAYER_PASSWORD}


def _enrolled(db_session: Session, **overrides: object) -> Player:
    """A player whose stored hash PLAYER_LOGIN really verifies against."""
    defaults: dict[str, object] = {
        "first_name": "Thomas",
        "last_name": "Kabalin",
        "username": "kbltho001",
        "password_hash": PLAYER_HASH,
    }
    player = make_player(db_session, **defaults | overrides)
    db_session.commit()
    return player


# --- POST /auth/player/login ---


def test_a_player_login_returns_their_own_profile_and_sets_the_player_cookie(
    client: TestClient, db_session: Session
) -> None:
    _enrolled(db_session)

    response = client.post("/auth/player/login", json=PLAYER_LOGIN)

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "kbltho001"
    assert body["first_name"] == "Thomas"
    assert client.cookies.get(PLAYER_SESSION_COOKIE)
    assert not client.cookies.get(SESSION_COOKIE)


def test_the_login_response_is_the_trimmed_self_view(
    client: TestClient, db_session: Session
) -> None:
    """PlayerSelfRead, not PlayerRead: the coach's notes about the player are the
    coach's, and the ownership plumbing is coach workflow. Their absence here is what
    the whole schema exists for, so it is pinned field by field."""
    _enrolled(db_session, notes="Second serve sits up under pressure.")

    body = client.post("/auth/player/login", json=PLAYER_LOGIN).json()

    assert "notes" not in body
    assert "coach_id" not in body
    assert "has_transfer_code" not in body
    assert "password_hash" not in body
    assert "Second serve" not in str(body)


def test_the_player_cookie_is_locked_down(client: TestClient, db_session: Session) -> None:
    """The coach cookie's flags over again, on a name of its own: `__Host-` binds it to
    this host, and the distinct name is what keeps a player session from ever being
    read as a coach login."""
    _enrolled(db_session)

    header = client.post("/auth/player/login", json=PLAYER_LOGIN).headers["set-cookie"]

    assert PLAYER_SESSION_COOKIE == "__Host-matchpoint_player_session"
    assert header.startswith(f"{PLAYER_SESSION_COOKIE}=")
    assert "httponly" in header.lower()
    assert "secure" in header.lower()
    assert "path=/" in header.lower()
    assert "domain=" not in header.lower()
    assert "samesite=lax" in header.lower()
    assert f"max-age={int(SESSION_LIFETIME.total_seconds())}" in header.lower()


def test_a_player_login_stores_the_hash_of_the_token_and_never_the_token(
    client: TestClient, db_session: Session
) -> None:
    _enrolled(db_session)
    client.post("/auth/player/login", json=PLAYER_LOGIN)
    token = client.cookies[PLAYER_SESSION_COOKIE]

    session_row = db_session.scalars(select(PlayerSession)).one()
    assert session_row.token_hash == hash_token(token)
    assert token not in session_row.token_hash


def test_a_wrong_password_is_rejected_without_a_session(
    client: TestClient, db_session: Session
) -> None:
    _enrolled(db_session)

    response = client.post("/auth/player/login", json=PLAYER_LOGIN | {"password": "wrong-wrong"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect username or password"}
    assert "set-cookie" not in response.headers
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 0


def test_an_unknown_username_answers_exactly_like_a_wrong_password(
    client: TestClient, db_session: Session
) -> None:
    """The response half of the enumeration defence, with higher stakes than email's:
    usernames are derived from names, so anyone who knows a player can guess theirs."""
    _enrolled(db_session)

    unknown = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": "ghost01"})
    wrong = client.post("/auth/player/login", json=PLAYER_LOGIN | {"password": "wrong-wrong"})

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_a_player_with_no_password_yet_answers_exactly_like_a_wrong_password(
    client: TestClient, db_session: Session
) -> None:
    """Every backfilled row is NULL until its coach mints a password, so 'no credential
    yet' must be indistinguishable from 'wrong password': anything else would let the
    login page say which of a club's players have been handed accounts."""
    make_player(db_session, username="ndlraf001")
    db_session.commit()

    bare = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": "ndlraf001"})

    assert bare.status_code == 401
    assert bare.json() == {"detail": "Incorrect username or password"}


@pytest.mark.parametrize("username", ["ghost01", "ndlraf001"])
def test_a_miss_still_burns_a_verification(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch, username: str
) -> None:
    """The timing half, for both kinds of miss: an unknown username and a row with no
    hash must each cost the Argon2 run a live credential costs. Pinned by spying on
    the route's verify_password rather than a stopwatch, as login's test does."""
    make_player(db_session, username="ndlraf001")
    db_session.commit()
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "matchpoint_api.routers.player_auth.verify_password",
        lambda password, password_hash: (calls.append((password, password_hash)), False)[1],
    )

    response = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": username})

    assert response.status_code == 401
    assert calls == [(PLAYER_PASSWORD, DUMMY_HASH)]


def test_a_mixed_case_username_finds_the_account(client: TestClient, db_session: Session) -> None:
    """Usernames are stored lowercase, and this one is typed off a piece of paper: the
    route's fold is what makes KBLTHO001 the same account."""
    _enrolled(db_session)

    response = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": "KBLTHO001"})

    assert response.status_code == 200


def test_a_stale_hash_is_upgraded_on_player_login(client: TestClient, db_session: Session) -> None:
    """Login's parameter-upgrade path holds for the player credential too: the minted
    password lives for years on a fridge magnet, so the one moment plaintext is in
    hand has to carry old rows forward."""
    stale_hash = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(PLAYER_PASSWORD)
    player = _enrolled(db_session, password_hash=stale_hash)

    response = client.post("/auth/player/login", json=PLAYER_LOGIN)

    assert response.status_code == 200
    refreshed = db_session.get(Player, player.id)
    assert refreshed is not None
    assert refreshed.password_hash is not None
    assert refreshed.password_hash != stale_hash
    assert "m=65536,t=3,p=1" in refreshed.password_hash


def test_logging_in_clears_only_the_player_s_own_expired_sessions(
    client: TestClient, db_session: Session
) -> None:
    """Login's sweep, scoped the same way: the signing-in player's dead rows go, and
    another player's are not this login's to touch."""
    player = _enrolled(db_session)
    make_player_session(
        db_session, player_id=player.id, expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    other = make_player_session(db_session, expires_at=datetime.now(UTC) - timedelta(seconds=1))
    db_session.commit()

    client.post("/auth/player/login", json=PLAYER_LOGIN)

    remaining = set(db_session.scalars(select(PlayerSession.id)))
    assert other.id in remaining
    assert len(remaining) == 2  # the other player's dead row, and the fresh login


# The race the row lock closes. A regenerate revokes the sessions that exist when it
# runs, so a request whose verification predates it must not insert one afterwards: the
# revoked password would keep working, on a session that renews itself for 30 days.

REGENERATED_HASH = hash_password("what-the-coach-just-minted")


def _regenerate_mid_verification(
    monkeypatch: pytest.MonkeyPatch, db_session: Session, player: Player
) -> None:
    """Land a coach's regenerate in the window a verification holds open.

    The suite shares one session, so no second request can genuinely run alongside this
    one: the new hash and the revocation are flushed from inside `verify_password`, where
    the coach's commit would land, leaving the row state the lock has to catch.
    """
    real = verify_password

    def verify_then_regenerate(password: str, password_hash: str) -> bool:
        verified = real(password, password_hash)
        player.password_hash = REGENERATED_HASH
        db_session.execute(delete(PlayerSession).where(PlayerSession.player_id == player.id))
        db_session.flush()
        return verified

    monkeypatch.setattr(
        "matchpoint_api.routers.player_auth.verify_password", verify_then_regenerate
    )


def _statements_of(db_session: Session) -> list[str]:
    """Collect the SQL a request emits, so a lock can be pinned where behaviour cannot
    reach it: one shared session cannot produce two concurrent requests, so a re-read
    without the lock leaves the window open and every test here green regardless."""
    statements: list[str] = []

    @event.listens_for(db_session.get_bind(), "before_cursor_execute")
    def _record(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    return statements


def test_a_login_that_verified_a_regenerated_password_mints_no_session(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The coach's takeover lever has to hold end to end: a login carrying the old
    password answers as a wrong one once the mint has landed, rather than handing back
    the very session the regenerate had just swept away."""
    player = _enrolled(db_session)
    _regenerate_mid_verification(monkeypatch, db_session, player)

    response = client.post("/auth/player/login", json=PLAYER_LOGIN)

    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect username or password"}
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 0
    assert not client.cookies.get(PLAYER_SESSION_COOKIE)


def test_a_login_locks_the_player_row_before_minting_a_session(
    client: TestClient, db_session: Session
) -> None:
    """The other half of the same race, the one behaviour cannot reach: the re-read has
    to hold the row until the session row is in, or a regenerate landing between the two
    sweeps a table the new session is not yet in."""
    _enrolled(db_session)
    statements = _statements_of(db_session)

    response = client.post("/auth/player/login", json=PLAYER_LOGIN)

    assert response.status_code == 200
    locked = [s for s in statements if "FROM players" in s and "FOR UPDATE" in s]
    assert locked
    assert statements.index(locked[0]) < next(
        i for i, s in enumerate(statements) if "INSERT INTO player_sessions" in s
    )


def _stub_out_verification(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail every verification without running Argon2, exactly as the login tests do:
    a failed verification is what the wrong-guess budget counts, so stubbing charges
    every bucket as a wrong password would."""
    monkeypatch.setattr("matchpoint_api.routers.player_auth.verify_password", lambda *_: False)


def test_wrong_guesses_beyond_the_account_burst_are_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The per-username budget at its burst (5). No player row exists: the bucket keys
    on the submitted username either way, so the 429 discloses nothing about which
    usernames hold accounts, exactly as login's does for emails."""
    _stub_out_verification(monkeypatch)
    for _ in range(5):
        assert client.post("/auth/player/login", json=PLAYER_LOGIN).status_code == 401

    response = client.post("/auth/player/login", json=PLAYER_LOGIN)

    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests"}


def test_the_account_bucket_folds_case(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The bucket key folds as the row lookup folds, or every casing of KBLTHO001
    would mint a fresh budget."""
    _stub_out_verification(monkeypatch)
    for _ in range(5):
        attempt = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": "KBLTHO001"})
        assert attempt.status_code == 401

    assert client.post("/auth/player/login", json=PLAYER_LOGIN).status_code == 429


def test_a_correct_password_is_never_refused_by_the_wrong_guess_budget(
    client: TestClient, db_session: Session
) -> None:
    """Charged only after a failed verification, so the budget cannot become a lockout
    lever: more correct logins than the burst still all land."""
    _enrolled(db_session)

    for _ in range(6):
        assert client.post("/auth/player/login", json=PLAYER_LOGIN).status_code == 200


def test_cycling_usernames_does_not_escape_the_address_burst(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Per-account alone would hand five free tries per invented username; the
    per-address tier bounds the arrivals themselves, at login's sizes (burst 20)."""
    _stub_out_verification(monkeypatch)
    for n in range(20):
        attempt = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": f"gst{n:03d}"})
        assert attempt.status_code == 401

    refused = client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": "gst999"})

    assert refused.status_code == 429


@pytest.mark.usefixtures("clock")
def test_player_login_has_a_total_bound_no_address_escapes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The shared bucket is what bounds a guessing run spread across edge addresses,
    for the same Cloudflare reason login's total tier exists."""
    _stub_out_verification(monkeypatch)
    for address in ("203.0.113.1", "203.0.113.2"):
        from_address = TestClient(client.app, headers=ORIGIN_HEADERS, client=(address, 50000))
        for n in range(10):
            body = PLAYER_LOGIN | {"username": f"gst{address[-1]}{n:02d}"}
            assert from_address.post("/auth/player/login", json=body).status_code == 401

    latecomer = TestClient(client.app, headers=ORIGIN_HEADERS, client=("203.0.113.3", 50000))

    assert latecomer.post("/auth/player/login", json=PLAYER_LOGIN).status_code == 429


def test_a_player_login_flood_spends_none_of_the_coach_login_budget(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The buckets are separate on purpose: draining the player entry point from an
    address must leave a coach at the same address able to sign in."""
    make_coach(db_session, email="mike@example.com", password_hash=PLAYER_HASH)
    db_session.commit()
    _stub_out_verification(monkeypatch)
    for n in range(20):
        client.post("/auth/player/login", json=PLAYER_LOGIN | {"username": f"gst{n:03d}"})
    assert client.post("/auth/player/login", json=PLAYER_LOGIN).status_code == 429

    coach_login = client.post(
        "/auth/login", json={"email": "mike@example.com", "password": PLAYER_PASSWORD}
    )

    assert coach_login.status_code == 200


# --- GET /auth/player/me ---


def test_me_returns_the_trimmed_profile(client: TestClient, db_session: Session) -> None:
    player = make_player(
        db_session, username="ndlraf001", notes="Runs around the backhand too early."
    )
    sign_in_player(client, db_session, player)

    response = client.get("/auth/player/me")

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "ndlraf001"
    assert "notes" not in body
    assert "coach_id" not in body
    assert "has_transfer_code" not in body


def test_me_needs_a_player_session(client: TestClient) -> None:
    response = client.get("/auth/player/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_a_coach_session_does_not_authenticate_a_player_route(
    client: TestClient, db_session: Session
) -> None:
    """The boundary the two cookie names exist for: a signed-in coach is still nobody
    to the player dependency, so the lesser principal's routes cannot be reached with
    the greater principal's credential, nor the reverse be assumed."""
    sign_in(client, db_session, make_coach(db_session))

    assert client.get("/auth/player/me").status_code == 401


def test_a_forged_player_cookie_is_refused(client: TestClient, db_session: Session) -> None:
    client.cookies.set(PLAYER_SESSION_COOKIE, new_session_token())

    assert client.get("/auth/player/me").status_code == 401


def test_an_expired_player_session_is_refused_and_deleted(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)
    sign_in_player(client, db_session, player, expires_at=datetime.now(UTC) - timedelta(seconds=1))

    response = client.get("/auth/player/me")

    assert response.status_code == 401
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 0


def test_a_session_past_halfway_is_renewed_with_a_fresh_cookie(
    client: TestClient, db_session: Session
) -> None:
    """The coach renewal over again through the second state key: the row's deadline
    moves and the browser is handed the new one under the player cookie's own name,
    so an active player never reaches expiry courtside."""
    player = make_player(db_session)
    session_row = sign_in_player(
        client, db_session, player, expires_at=datetime.now(UTC) + timedelta(days=5)
    )
    old_deadline = session_row.expires_at

    response = client.get("/auth/player/me")

    assert response.status_code == 200
    db_session.expire(session_row)
    assert session_row.expires_at > old_deadline
    header = response.headers["set-cookie"]
    assert header.startswith(f"{PLAYER_SESSION_COOKIE}=")


def test_a_fresh_session_is_not_renewed(client: TestClient, db_session: Session) -> None:
    """Renewal from the halfway mark only, so reads do not pay a write per request."""
    player = make_player(db_session)
    sign_in_player(client, db_session, player)

    response = client.get("/auth/player/me")

    assert response.status_code == 200
    assert "set-cookie" not in response.headers


def test_a_gc_roll_hit_sweeps_expired_player_sessions(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The probabilistic sweep, forced to hit: rows abandoned by players who never
    return are somebody's to delete, and this is the only somebody."""
    player = make_player(db_session)
    sign_in_player(client, db_session, player)
    expired = make_player_session(db_session, expires_at=datetime.now(UTC) - timedelta(seconds=1))
    live = make_player_session(db_session)
    db_session.commit()

    monkeypatch.setattr("matchpoint_api.auth.secrets.randbelow", lambda _: 0)
    assert client.get("/auth/player/me").status_code == 200

    assert db_session.get(PlayerSession, expired.id) is None
    assert db_session.get(PlayerSession, live.id) is not None


def test_a_missed_gc_roll_leaves_expired_player_sessions_alone(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    player = make_player(db_session)
    sign_in_player(client, db_session, player)
    expired = make_player_session(db_session, expires_at=datetime.now(UTC) - timedelta(seconds=1))
    db_session.commit()

    monkeypatch.setattr("matchpoint_api.auth.secrets.randbelow", lambda _: 1)
    assert client.get("/auth/player/me").status_code == 200

    assert db_session.get(PlayerSession, expired.id) is not None


@pytest.mark.usefixtures("clock")
def test_requests_beyond_the_per_player_budget_are_refused(
    client: TestClient, db_session: Session
) -> None:
    """The per-player counterpart of the per-coach ceiling, at its own burst (60):
    one budget across everything a player session can reach."""
    player = make_player(db_session)
    sign_in_player(client, db_session, player)
    for _ in range(60):
        assert client.get("/auth/player/me").status_code == 200

    response = client.get("/auth/player/me")

    assert response.status_code == 429


# --- POST /auth/player/change-password ---

NEW_PASSWORD = "a-new-password"


def _change(client: TestClient, **overrides: object) -> httpx2.Response:
    """Change with defaults that verify, then repair the cookie jar.

    A 204 that rotates the session answers with Set-Cookie, and the jar then holds two
    cookies of one name (the hand-set one has a different jar identity than the
    server's), so reading it raises CookieConflict: cleared and re-set from the
    response, as the coach change tests do.
    """
    body: dict[str, object] = {"password": PLAYER_PASSWORD, "new_password": NEW_PASSWORD}
    response = client.post("/auth/player/change-password", json=body | overrides)
    rotated = response.cookies.get(PLAYER_SESSION_COOKIE)
    if rotated:
        client.cookies.clear()
        client.cookies.set(PLAYER_SESSION_COOKIE, rotated)
    return response


def test_the_current_password_buys_a_new_one(client: TestClient, db_session: Session) -> None:
    """The player's way off the coach-minted password, which is the point of the route:
    the fridge-magnet credential stops working the moment they choose their own."""
    _enrolled(db_session)
    client.post("/auth/player/login", json=PLAYER_LOGIN)

    response = _change(client)

    assert response.status_code == 204
    fresh = TestClient(client.app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS)
    assert (
        fresh.post("/auth/player/login", json=PLAYER_LOGIN | {"password": NEW_PASSWORD}).status_code
        == 200
    )
    assert fresh.post("/auth/player/login", json=PLAYER_LOGIN).status_code == 401


def test_the_change_ends_every_other_session_and_keeps_the_caller_signed_in(
    client: TestClient, db_session: Session
) -> None:
    """Every session dies, the presented one included, and the caller continues on a
    fresh one: a thief holds a copy of the same token, so sparing the presented row
    would spare the thief. Exactly one Set-Cookie, through the renewal channel."""
    player = _enrolled(db_session)
    other_device = make_player_session(db_session, player_id=player.id)
    db_session.commit()
    sign_in_player(client, db_session, player)

    response = _change(client)

    assert response.status_code == 204
    assert len(response.headers.get_list("set-cookie")) == 1
    assert db_session.get(PlayerSession, other_device.id) is None
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 1
    assert client.get("/auth/player/me").status_code == 200


def test_a_change_from_a_session_due_for_renewal_hands_back_the_new_token(
    client: TestClient, db_session: Session
) -> None:
    """current_player may already have queued a renewal of the token this request just
    revoked; the handler writes the same state key afterwards, so the one Set-Cookie
    the browser gets carries the fresh token, not a corpse."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player, expires_at=datetime.now(UTC) + timedelta(days=5))

    response = _change(client)

    assert response.status_code == 204
    assert len(response.headers.get_list("set-cookie")) == 1
    assert client.get("/auth/player/me").status_code == 200


def test_a_wrong_current_password_is_a_403_that_changes_nothing(
    client: TestClient, db_session: Session
) -> None:
    """403 rather than 401: 401 on this route already means the session is gone, and
    the form has to tell 'sign in again' apart from 'that password is wrong'."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)

    response = _change(client, password="wrong-wrong-wrong")

    assert response.status_code == 403
    assert response.json() == {"detail": "Incorrect password"}
    refreshed = db_session.get(Player, player.id)
    assert refreshed is not None
    assert refreshed.password_hash == PLAYER_HASH


def test_a_session_whose_player_has_no_hash_hears_the_same_403(
    client: TestClient, db_session: Session
) -> None:
    """The None-guard for the race a regenerate can win against an in-flight change:
    a session can outlive the credential it was earned with, and the route must
    answer 403 rather than crash on the NULL."""
    player = make_player(db_session)
    sign_in_player(client, db_session, player)

    response = _change(client)

    assert response.status_code == 403


def test_wrong_guesses_beyond_the_player_s_budget_are_refused(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A stolen session gets five guesses at the password, and one every minute or so
    after that, not a quiet run at it: the budget is charged only for failures."""
    player = make_player(db_session, password_hash=PLAYER_HASH)
    sign_in_player(client, db_session, player)
    _stub_out_verification(monkeypatch)
    for _ in range(5):
        assert _change(client).status_code == 403

    response = _change(client)

    assert response.status_code == 429


def test_a_correct_password_is_never_refused_by_the_wrong_guess_budget_here_either(
    client: TestClient, db_session: Session
) -> None:
    """Charged after a failed verification only, so the guesses a thief spends cannot
    lock the player out of the very change that ends the thief's access."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)
    for _ in range(5):
        assert _change(client, password="wrong-wrong-wrong").status_code == 403

    assert _change(client).status_code == 204


def test_a_change_to_a_breached_password_is_a_400(client: TestClient, db_session: Session) -> None:
    """The chosen replacement meets the full policy the minted password skipped: it is
    human-chosen, which is exactly what the policy exists for."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)
    breach_every_password(client)

    response = _change(client)

    assert response.status_code == 400
    assert response.json() == {"detail": "Password has appeared in a known data breach"}
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 1


def test_the_policy_takes_the_player_s_own_words(client: TestClient, db_session: Session) -> None:
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)

    response = _change(client, new_password="kbltho001-forever")

    assert response.status_code == 400
    assert response.json() == {"detail": "Password contains your name or email address"}


def test_a_wrong_current_password_answers_before_the_policy_does(
    client: TestClient, db_session: Session
) -> None:
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)
    breach_every_password(client)

    response = _change(client, password="wrong-wrong-wrong")

    assert response.status_code == 403


@pytest.mark.usefixtures("clock")
def test_an_unauthenticated_flood_spends_none_of_the_change_budget(
    client: TestClient, db_session: Session
) -> None:
    """The arrival tiers are metered after the session resolves, unlike login's: a
    stranger's 401s must not drain the shared bucket and 429 every player off the
    route. The coach route made the same call, for the same reason."""
    fresh = TestClient(client.app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS)
    for _ in range(31):
        refused = fresh.post(
            "/auth/player/change-password",
            json={"password": PLAYER_PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert refused.status_code == 401
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)

    assert _change(client).status_code == 204


@pytest.mark.usefixtures("clock")
def test_a_stolen_session_flood_cannot_429_the_change(
    client: TestClient, db_session: Session
) -> None:
    """The recovery budget's point: ordinary traffic through a stolen cookie drains the
    shared per-player budget, and the change must stay reachable regardless, since it
    is the route that ends the theft."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)
    for _ in range(60):
        assert client.get("/auth/player/me").status_code == 200
    assert client.get("/auth/player/me").status_code == 429

    assert _change(client).status_code == 204


def test_a_rejected_change_echoes_neither_password(client: TestClient, db_session: Session) -> None:
    """The 422-redaction backstop, on the one player body carrying two secrets. 'tiny'
    rather than 'short' because pydantic's own error type is string_too_short, which
    would let the assertion pass for the wrong reason."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)

    response = _change(client, new_password="tiny")

    assert response.status_code == 422
    assert "tiny" not in response.text
    assert PLAYER_PASSWORD not in response.text


def test_a_change_verified_before_a_regenerate_overwrites_neither_hash_nor_revocation(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The regenerate has to be the last word. A change whose current-password proof
    predates it would otherwise write over the password the coach was just shown and
    mint itself a session out of the revocation's reach: a stolen cookie keeping the
    account, and the coach holding a credential that no longer works."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)
    _regenerate_mid_verification(monkeypatch, db_session, player)

    response = _change(client)

    assert response.status_code == 403
    assert response.json() == {"detail": "Incorrect password"}
    refreshed = db_session.get(Player, player.id)
    assert refreshed is not None
    assert refreshed.password_hash == REGENERATED_HASH
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 0


def test_a_change_locks_the_player_row_before_writing_the_new_hash(
    client: TestClient, db_session: Session
) -> None:
    """`current_player` resolves the row unlocked, so the write needs its own lock for
    the login route's reason, and pinned on the SQL for the login route's reason."""
    player = _enrolled(db_session)
    sign_in_player(client, db_session, player)
    statements = _statements_of(db_session)

    response = _change(client)

    assert response.status_code == 204
    locked = [s for s in statements if "FROM players" in s and "FOR UPDATE" in s]
    assert locked
    assert statements.index(locked[0]) < next(
        i for i, s in enumerate(statements) if "UPDATE players" in s
    )


# --- POST /auth/player/logout ---


def test_logging_out_revokes_the_session_and_clears_the_player_cookie(
    client: TestClient, db_session: Session
) -> None:
    _enrolled(db_session)
    client.post("/auth/player/login", json=PLAYER_LOGIN)

    response = client.post("/auth/player/logout")

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 0
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert not client.cookies.get(PLAYER_SESSION_COOKIE)


def test_logging_out_only_ends_the_presented_session(
    client: TestClient, db_session: Session
) -> None:
    _enrolled(db_session)
    client.post("/auth/player/login", json=PLAYER_LOGIN)
    other_device_token = client.cookies[PLAYER_SESSION_COOKIE]
    client.cookies.clear()
    client.post("/auth/player/login", json=PLAYER_LOGIN)

    client.post("/auth/player/logout")

    remaining = db_session.scalars(select(PlayerSession)).one()
    assert remaining.token_hash == hash_token(other_device_token)


def test_logging_out_signed_out_is_still_a_204(client: TestClient) -> None:
    assert client.post("/auth/player/logout").status_code == 204


def test_logging_out_with_a_forged_cookie_revokes_nothing(
    client: TestClient, db_session: Session
) -> None:
    """logout's forged-cookie promise: a token hashing to no row deletes no row, or
    this would be revocation as a service against other players' sessions."""
    player = make_player(db_session)
    make_player_session(db_session, player_id=player.id)
    db_session.commit()
    client.cookies.set(PLAYER_SESSION_COOKIE, new_session_token())

    response = client.post("/auth/player/logout")

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(PlayerSession)) == 1


def test_a_player_logout_leaves_a_coach_session_on_the_same_browser_alone(
    client: TestClient, db_session: Session
) -> None:
    """The two principals can share a family tablet: signing the player out must not
    touch the coach's cookie or row, which their separate names are for."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    player = make_player(db_session, coach_id=coach.id)
    sign_in_player(client, db_session, player)

    response = client.post("/auth/player/logout")

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(CoachSession)) == 1
    assert client.cookies.get(SESSION_COOKIE)
    assert client.get("/coaches/me").status_code == 200
