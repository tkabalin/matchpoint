import uuid

import pytest
from fastapi.testclient import TestClient
from psycopg.errors import CheckViolation
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from matchpoint_api.models import Coach
from matchpoint_api.security import verify_password
from tests.factories import make_coach

SIGN_UP = {
    "email": "mike@example.com",
    "display_name": "Coach Mike",
    "password": "a-good-password",
}


def test_signing_up_returns_the_new_coach(client: TestClient) -> None:
    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "mike@example.com"
    assert body["display_name"] == "Coach Mike"
    assert uuid.UUID(body["id"])
    assert body["created_at"] is not None
    assert body["updated_at"] is not None


def test_signing_up_never_echoes_the_password_or_its_hash(client: TestClient) -> None:
    """The response is filtered by CoachRead, which carries neither field. Asserted on
    the plaintext too, since that one came in on this very request."""
    response = client.post("/coaches", json=SIGN_UP)

    assert "password_hash" not in response.json()
    assert "password" not in response.json()
    assert "a-good-password" not in response.text


def test_signing_up_stores_a_hash_the_password_verifies_against(
    client: TestClient, db_session: Session
) -> None:
    """The end the route owns: the plaintext must not reach the column, and what does
    reach it has to be something a later login can check the password against."""
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
    first = client.post("/coaches", json=SIGN_UP | {"email": "mike@example.com"})
    second = client.post("/coaches", json=SIGN_UP | {"email": "sam@example.com"})

    hashes = set()
    for response in (first, second):
        coach = db_session.get(Coach, uuid.UUID(response.json()["id"]))
        assert coach is not None
        hashes.add(coach.password_hash)

    assert len(hashes) == 2


def test_a_mixed_case_email_is_stored_and_read_back_lowercased(client: TestClient) -> None:
    """EmailStr folds the domain, so the local part is the model's `validates` to do — and
    this is the test that fails if that ever comes out. Read back through the other route
    because a coach signing in as Mike@ has to find the row stored as mike@."""
    response = client.post("/coaches", json=SIGN_UP | {"email": "Mike@Example.com"})

    assert response.status_code == 201
    assert response.json()["email"] == "mike@example.com"
    assert client.get(f"/coaches/{response.json()['id']}").json()["email"] == "mike@example.com"


def test_signing_up_twice_with_one_email_is_a_conflict(
    client: TestClient, db_session: Session
) -> None:
    """409 rather than the 500 an uncaught IntegrityError would be. Email is the sign-in
    identity, so the second attempt is not a duplicate row but an ambiguous login.

    The body is asserted too, because the route declares the 409 as ErrorDetail and the
    generated client is typed from that declaration — a response that stopped matching it
    would be a client reading a field that is not there."""
    assert client.post("/coaches", json=SIGN_UP).status_code == 201

    response = client.post("/coaches", json=SIGN_UP)

    assert response.status_code == 409
    assert response.json() == {"detail": "Email already registered"}
    assert db_session.scalar(select(func.count()).select_from(Coach)) == 1


def test_an_email_differing_only_in_case_is_a_conflict(client: TestClient) -> None:
    """The case a plain UNIQUE constraint would miss, since Postgres compares it
    case-sensitively — it is the model lowercasing on the way in that turns this into the
    same address, and so into the conflict above."""
    assert client.post("/coaches", json=SIGN_UP | {"email": "mike@example.com"}).status_code == 201

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
    behind it — and flag_modified is what still gets the change into the next flush, which
    is the flush the route's own commit performs.
    """
    coach = make_coach(db_session)
    db_session.commit()
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


def test_get_coach_returns_the_row(client: TestClient, db_session: Session) -> None:
    coach = make_coach(db_session, email="mike@example.com", display_name="Coach Mike")
    db_session.commit()

    response = client.get(f"/coaches/{coach.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(coach.id)
    assert body["email"] == "mike@example.com"
    assert body["display_name"] == "Coach Mike"
    assert body["created_at"] is not None
    assert body["updated_at"] is not None


def test_get_coach_never_returns_the_password_hash(client: TestClient, db_session: Session) -> None:
    """Checked at the boundary that matters: response_model filters a response to
    CoachRead's fields, so the hash is dropped here — but only for as long as CoachRead
    leaves it out. Sign-up returns a Coach row too, and is asserted on separately."""
    coach = make_coach(db_session, password_hash="not-a-real-hash")
    db_session.commit()

    response = client.get(f"/coaches/{coach.id}")

    assert response.status_code == 200
    assert "password_hash" not in response.json()
    assert "not-a-real-hash" not in response.text


def test_get_coach_returns_404_for_an_unknown_id(client: TestClient) -> None:
    response = client.get(f"/coaches/{uuid.uuid4()}")

    assert response.status_code == 404


def test_get_coach_returns_422_for_a_malformed_id(client: TestClient) -> None:
    """The path parameter is a uuid.UUID, so FastAPI rejects a non-UUID before the
    handler runs — nothing here reaches the database."""
    response = client.get("/coaches/not-a-uuid")

    assert response.status_code == 422


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
