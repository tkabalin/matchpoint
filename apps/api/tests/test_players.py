import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.models import DominantHand, Player

NOTES_LIMIT = 2000


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"first_name": "Serena", "last_name": "Williams"}
    return payload | overrides


def test_create_player_persists_and_returns_row(client: TestClient, db_session: Session) -> None:
    response = client.post("/players", json=_payload(dominant_hand="right"))

    assert response.status_code == 201
    body = response.json()
    assert body["first_name"] == "Serena"
    assert body["last_name"] == "Williams"
    assert body["dominant_hand"] == "right"
    assert body["created_at"] is not None

    saved = db_session.get(Player, uuid.UUID(body["id"]))
    assert saved is not None
    assert saved.last_name == "Williams"


def test_create_player_with_every_optional_field(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/players",
        json=_payload(
            date_of_birth="1981-09-26",
            dominant_hand="right",
            gender="female",
            notes="Serve +1 to the forehand.",
        ),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["date_of_birth"] == "1981-09-26"
    assert body["gender"] == "female"
    assert body["notes"] == "Serve +1 to the forehand."

    saved = db_session.get(Player, uuid.UUID(body["id"]))
    assert saved is not None
    assert saved.date_of_birth == date(1981, 9, 26)


def test_create_player_without_optional_fields(client: TestClient) -> None:
    response = client.post("/players", json=_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["dominant_hand"] is None
    assert body["date_of_birth"] is None
    assert body["gender"] is None
    assert body["notes"] is None


def test_create_player_cannot_set_coach_id_or_archived_at(client: TestClient) -> None:
    """Neither field is on PlayerCreate, so pydantic drops them rather than 422ing —
    what matters is that a client cannot claim ownership of a player or file one as
    already archived. Both come back null despite being sent.
    """
    response = client.post(
        "/players",
        json=_payload(coach_id=str(uuid.uuid4()), archived_at="2020-01-01T00:00:00Z"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["coach_id"] is None
    assert body["archived_at"] is None


def test_create_player_rejects_future_date_of_birth(client: TestClient) -> None:
    tomorrow = date.today() + timedelta(days=1)

    response = client.post("/players", json=_payload(date_of_birth=tomorrow.isoformat()))

    assert response.status_code == 422


def test_create_player_rejects_implausibly_old_date_of_birth(client: TestClient) -> None:
    response = client.post("/players", json=_payload(date_of_birth="1850-01-01"))

    assert response.status_code == 422


def test_create_player_accepts_a_plausibly_old_date_of_birth(client: TestClient) -> None:
    """Guards the bound from being tightened into rejecting real players."""
    response = client.post("/players", json=_payload(date_of_birth="1930-01-01"))

    assert response.status_code == 201


def test_create_player_accepts_date_of_birth_of_today(client: TestClient) -> None:
    """Today is not the future, so it is valid — pydantic's PastDate would reject it."""
    today = date.today()

    response = client.post("/players", json=_payload(date_of_birth=today.isoformat()))

    assert response.status_code == 201
    assert response.json()["date_of_birth"] == today.isoformat()


def test_create_player_rejects_missing_first_name(client: TestClient) -> None:
    response = client.post("/players", json={"last_name": "Williams"})

    assert response.status_code == 422


def test_create_player_rejects_missing_last_name(client: TestClient) -> None:
    response = client.post("/players", json={"first_name": "Serena"})

    assert response.status_code == 422


def test_create_player_rejects_invalid_dominant_hand(client: TestClient) -> None:
    response = client.post("/players", json=_payload(dominant_hand="ambidextrous"))

    assert response.status_code == 422


def test_create_player_rejects_invalid_gender(client: TestClient) -> None:
    response = client.post("/players", json=_payload(gender="unspecified"))

    assert response.status_code == 422


def test_create_player_rejects_overlong_name(client: TestClient) -> None:
    response = client.post("/players", json=_payload(first_name="x" * 101))

    assert response.status_code == 422


def test_create_player_rejects_overlong_notes(client: TestClient) -> None:
    response = client.post("/players", json=_payload(notes="x" * (NOTES_LIMIT + 1)))

    assert response.status_code == 422


def test_create_player_rejects_whitespace_only_name(client: TestClient) -> None:
    response = client.post("/players", json=_payload(last_name="   "))

    assert response.status_code == 422


def test_create_player_strips_surrounding_whitespace(client: TestClient) -> None:
    response = client.post("/players", json=_payload(first_name="  Serena  "))

    assert response.status_code == 201
    assert response.json()["first_name"] == "Serena"


def test_list_players_returns_all_sorted_by_last_then_first_name(
    client: TestClient, db_session: Session
) -> None:
    """Sorted by surname, and the given name only breaks ties — so the two Williamses
    have to come back in given-name order while still sitting after Swiatek."""
    db_session.add_all(
        [
            Player(first_name="Venus", last_name="Williams"),
            Player(first_name="Iga", last_name="Swiatek"),
            Player(first_name="Serena", last_name="Williams", dominant_hand=DominantHand.RIGHT),
        ]
    )
    db_session.commit()

    response = client.get("/players")

    assert response.status_code == 200
    assert [(p["first_name"], p["last_name"]) for p in response.json()] == [
        ("Iga", "Swiatek"),
        ("Serena", "Williams"),
        ("Venus", "Williams"),
    ]


def test_list_players_omits_archived_players(client: TestClient, db_session: Session) -> None:
    """Archiving is a soft delete, so the roster has to filter on it. Set directly
    here — no endpoint writes archived_at yet."""
    db_session.add_all(
        [
            Player(first_name="Iga", last_name="Swiatek"),
            Player(
                first_name="Ash",
                last_name="Barty",
                archived_at=datetime(2022, 3, 23, tzinfo=UTC),
            ),
        ]
    )
    db_session.commit()

    response = client.get("/players")

    assert response.status_code == 200
    assert [p["last_name"] for p in response.json()] == ["Swiatek"]


def test_get_player_returns_one(client: TestClient, db_session: Session) -> None:
    player = Player(first_name="Serena", last_name="Williams")
    db_session.add(player)
    db_session.commit()

    response = client.get(f"/players/{player.id}")

    assert response.status_code == 200
    assert response.json()["last_name"] == "Williams"


def test_get_player_still_returns_an_archived_player(
    client: TestClient, db_session: Session
) -> None:
    """Archived players drop off the roster but stay fetchable by id: a match already
    references one, and a 404 there would break history rather than hide a name."""
    archived_at = datetime(2022, 3, 23, tzinfo=UTC)
    player = Player(first_name="Ash", last_name="Barty", archived_at=archived_at)
    db_session.add(player)
    db_session.commit()

    response = client.get(f"/players/{player.id}")

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


def test_get_player_unknown_id_is_404(client: TestClient) -> None:
    response = client.get(f"/players/{uuid.uuid4()}")

    assert response.status_code == 404