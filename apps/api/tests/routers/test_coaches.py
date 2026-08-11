import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import make_coach


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
    """The one route that returns a Coach row, checked at the boundary that matters:
    response_model filters to CoachRead's fields, so the hash is dropped here — but only
    for as long as CoachRead leaves it out."""
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
    whatever authenticates the caller."""
    response = client.get("/coaches")

    assert response.status_code == 404
