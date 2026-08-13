import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.models import Coach, DominantHand, Player
from tests.factories import make_coach, make_player, sign_in

NOTES_LIMIT = 2000


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"first_name": "Serena", "last_name": "Williams"}
    return payload | overrides


@pytest.fixture
def coach(client: TestClient, db_session: Session) -> Coach:
    """The coach the client is signed in as.

    Every player route requires a session, so even the pure-validation tests take this
    fixture — without it the dependency's 401 would answer before the 422 they are
    about."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    return coach


def test_create_player_persists_and_returns_row(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
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


def test_create_player_belongs_to_the_caller(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Ownership comes from the session: nothing in the body names a coach, and the
    row lands owned by the one the cookie resolves to."""
    response = client.post("/players", json=_payload())

    assert response.status_code == 201
    assert response.json()["coach_id"] == str(coach.id)

    saved = db_session.get(Player, uuid.UUID(response.json()["id"]))
    assert saved is not None
    assert saved.coach_id == coach.id


def test_create_player_with_every_optional_field(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
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


@pytest.mark.usefixtures("coach")
def test_create_player_without_optional_fields(client: TestClient) -> None:
    response = client.post("/players", json=_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["dominant_hand"] is None
    assert body["date_of_birth"] is None
    assert body["gender"] is None
    assert body["notes"] is None


def test_create_player_cannot_set_coach_id_or_archived_at(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Neither field is on PlayerCreate, so pydantic drops them rather than 422ing —
    what matters is that a client cannot hand a player to another coach or file one as
    already archived. The row lands owned by the caller regardless of what was sent.
    """
    other = make_coach(db_session)
    db_session.commit()

    response = client.post(
        "/players",
        json=_payload(coach_id=str(other.id), archived_at="2020-01-01T00:00:00Z"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["coach_id"] == str(coach.id)
    assert body["archived_at"] is None


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_future_date_of_birth(client: TestClient) -> None:
    tomorrow = date.today() + timedelta(days=1)

    response = client.post("/players", json=_payload(date_of_birth=tomorrow.isoformat()))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_implausibly_old_date_of_birth(client: TestClient) -> None:
    response = client.post("/players", json=_payload(date_of_birth="1850-01-01"))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_accepts_a_plausibly_old_date_of_birth(client: TestClient) -> None:
    """Guards the bound from being tightened into rejecting real players."""
    response = client.post("/players", json=_payload(date_of_birth="1930-01-01"))

    assert response.status_code == 201


@pytest.mark.usefixtures("coach")
def test_create_player_accepts_date_of_birth_of_today(client: TestClient) -> None:
    """Today is not the future, so it is valid — pydantic's PastDate would reject it."""
    today = date.today()

    response = client.post("/players", json=_payload(date_of_birth=today.isoformat()))

    assert response.status_code == 201
    assert response.json()["date_of_birth"] == today.isoformat()


@pytest.mark.usefixtures("coach")
def test_create_player_accepts_an_explicit_null_date_of_birth(client: TestClient) -> None:
    """Not the same path as omitting the field: an explicit null is handed to the
    validator, where an absent field skips it entirely."""
    response = client.post("/players", json=_payload(date_of_birth=None))

    assert response.status_code == 201
    assert response.json()["date_of_birth"] is None


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_missing_first_name(client: TestClient) -> None:
    response = client.post("/players", json={"last_name": "Williams"})

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_missing_last_name(client: TestClient) -> None:
    response = client.post("/players", json={"first_name": "Serena"})

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_invalid_dominant_hand(client: TestClient) -> None:
    response = client.post("/players", json=_payload(dominant_hand="ambidextrous"))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_invalid_gender(client: TestClient) -> None:
    response = client.post("/players", json=_payload(gender="unspecified"))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_overlong_name(client: TestClient) -> None:
    response = client.post("/players", json=_payload(first_name="x" * 101))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_accepts_name_at_the_length_limit(client: TestClient) -> None:
    """Pairs with the test above so the boundary is pinned from both sides — an
    off-by-one in ShortText would otherwise pass."""
    response = client.post("/players", json=_payload(first_name="x" * 100))

    assert response.status_code == 201


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_overlong_notes(client: TestClient) -> None:
    response = client.post("/players", json=_payload(notes="x" * (NOTES_LIMIT + 1)))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_accepts_notes_at_the_length_limit(client: TestClient) -> None:
    """LongText's bound is the schema's alone — the column is unbounded Text — so
    only this pins that the limit reaches the route at all."""
    response = client.post("/players", json=_payload(notes="x" * NOTES_LIMIT))

    assert response.status_code == 201


@pytest.mark.usefixtures("coach")
def test_create_player_rejects_whitespace_only_name(client: TestClient) -> None:
    response = client.post("/players", json=_payload(last_name="   "))

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_player_strips_surrounding_whitespace(client: TestClient) -> None:
    response = client.post("/players", json=_payload(first_name="  Serena  "))

    assert response.status_code == 201
    assert response.json()["first_name"] == "Serena"


def test_list_players_returns_all_sorted_by_last_then_first_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Sorted by surname, and the given name only breaks ties — so the two Williamses
    have to come back in given-name order while still sitting after Swiatek."""
    make_player(db_session, first_name="Venus", last_name="Williams", coach_id=coach.id)
    make_player(db_session, first_name="Iga", last_name="Swiatek", coach_id=coach.id)
    make_player(
        db_session,
        first_name="Serena",
        last_name="Williams",
        dominant_hand=DominantHand.RIGHT,
        coach_id=coach.id,
    )
    db_session.commit()

    response = client.get("/players")

    assert response.status_code == 200
    assert [(p["first_name"], p["last_name"]) for p in response.json()] == [
        ("Iga", "Swiatek"),
        ("Serena", "Williams"),
        ("Venus", "Williams"),
    ]


def test_list_players_omits_archived_players(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Archiving is a soft delete, so the roster has to filter on it. Set directly
    here — no endpoint writes archived_at yet."""
    make_player(db_session, first_name="Iga", last_name="Swiatek", coach_id=coach.id)
    make_player(
        db_session,
        first_name="Ash",
        last_name="Barty",
        archived_at=datetime(2022, 3, 23, tzinfo=UTC),
        coach_id=coach.id,
    )
    db_session.commit()

    response = client.get("/players")

    assert response.status_code == 200
    assert [p["last_name"] for p in response.json()] == ["Swiatek"]


def test_list_players_omits_another_coachs_players(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The roster is the caller's alone: with two coaches in the table, the other's
    player must be absent outright, not merely sorted elsewhere."""
    make_player(db_session, first_name="Iga", last_name="Swiatek", coach_id=coach.id)
    # No coach_id, so the factory mints the other coach itself.
    make_player(db_session, first_name="Coco", last_name="Gauff")
    db_session.commit()

    response = client.get("/players")

    assert response.status_code == 200
    assert [p["last_name"] for p in response.json()] == ["Swiatek"]


def test_get_player_returns_one(client: TestClient, db_session: Session, coach: Coach) -> None:
    player = make_player(db_session, first_name="Serena", last_name="Williams", coach_id=coach.id)
    db_session.commit()

    response = client.get(f"/players/{player.id}")

    assert response.status_code == 200
    assert response.json()["last_name"] == "Williams"


def test_get_player_still_returns_an_archived_player(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Archived players drop off the roster but stay fetchable by id: a match already
    references one, and a 404 there would break history rather than hide a name."""
    archived_at = datetime(2022, 3, 23, tzinfo=UTC)
    player = make_player(
        db_session, first_name="Ash", last_name="Barty", archived_at=archived_at, coach_id=coach.id
    )
    db_session.commit()

    response = client.get(f"/players/{player.id}")

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


def test_get_player_of_another_coach_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """404 and not 403, the recorded call: a 403 confirms the id exists, which hands
    an enumerator exactly what unguessable UUIDs exist to withhold."""
    other_player = make_player(db_session)
    db_session.commit()

    response = client.get(f"/players/{other_player.id}")

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_list_players_with_none_stored_is_an_empty_list(client: TestClient) -> None:
    response = client.get("/players")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.usefixtures("coach")
def test_get_player_unknown_id_is_404(client: TestClient) -> None:
    response = client.get(f"/players/{uuid.uuid4()}")

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_get_player_malformed_id_is_422(client: TestClient) -> None:
    """A non-UUID path segment fails path validation rather than reaching the
    handler, so it is a 422 and not the 404 an unknown id gets."""
    response = client.get("/players/not-a-uuid")

    assert response.status_code == 422


def test_update_player_changes_only_the_fields_sent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The point of exclude_unset: last_name is absent from the body, so it survives a
    PATCH that renames the player."""
    player = make_player(
        db_session, first_name="Serena", last_name="Williams", notes="Serve +1.", coach_id=coach.id
    )
    db_session.commit()

    response = client.patch(f"/players/{player.id}", json={"first_name": "Venus"})

    assert response.status_code == 200
    body = response.json()
    assert body["first_name"] == "Venus"
    assert body["last_name"] == "Williams"
    assert body["notes"] == "Serve +1."

    saved = db_session.get(Player, player.id)
    assert saved is not None
    assert saved.first_name == "Venus"


def test_update_player_clears_a_nullable_field_with_an_explicit_null(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Null is how a client empties a field, which is the whole reason absent and null
    have to stay distinguishable."""
    player = make_player(
        db_session, date_of_birth=date(1981, 9, 26), notes="Serve +1.", coach_id=coach.id
    )
    db_session.commit()

    response = client.patch(f"/players/{player.id}", json={"date_of_birth": None})

    assert response.status_code == 200
    assert response.json()["date_of_birth"] is None
    assert response.json()["notes"] == "Serve +1."

    saved = db_session.get(Player, player.id)
    assert saved is not None
    assert saved.date_of_birth is None


@pytest.mark.parametrize("field", ["first_name", "last_name"])
def test_update_player_rejects_a_null_name_part(
    client: TestClient, db_session: Session, coach: Coach, field: str
) -> None:
    """The columns are NOT NULL, and UNSET is what turns null into this 422 rather than
    an IntegrityError on the flush."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.patch(f"/players/{player.id}", json={field: None})

    assert response.status_code == 422


def test_update_player_with_an_empty_body_changes_nothing(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A PATCH with nothing set is a 200 no-op rather than an error: with every field
    optional there is no body that could be too empty to be valid."""
    player = make_player(db_session, first_name="Serena", last_name="Williams", coach_id=coach.id)
    db_session.commit()

    response = client.patch(f"/players/{player.id}", json={})

    assert response.status_code == 200
    assert response.json()["first_name"] == "Serena"
    assert response.json()["last_name"] == "Williams"


def test_update_player_bumps_updated_at(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Nothing in the route touches updated_at, so this pins that the column's onupdate
    is what moves it."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    before = player.updated_at

    response = client.patch(f"/players/{player.id}", json={"first_name": "Iga"})

    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["updated_at"]) > before


def test_update_player_ignores_coach_id_and_archived_at(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Neither field is on PlayerUpdate, so pydantic drops them rather than 422ing —
    what matters is that a PATCH cannot hand a player to another coach or archive one.
    """
    other = make_coach(db_session)
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.patch(
        f"/players/{player.id}",
        json={"coach_id": str(other.id), "archived_at": "2020-01-01T00:00:00Z"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["coach_id"] == str(coach.id)
    assert body["archived_at"] is None


def test_update_player_rejects_a_future_date_of_birth(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The create bounds are shared with the update, so an edit cannot land a date the
    create route would have refused."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    tomorrow = date.today() + timedelta(days=1)

    response = client.patch(f"/players/{player.id}", json={"date_of_birth": tomorrow.isoformat()})

    assert response.status_code == 422


def test_update_player_of_another_coach_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """404 and not 403, as on the fetch — and the row has to come through untouched."""
    other_player = make_player(db_session, first_name="Coco", last_name="Gauff")
    db_session.commit()

    response = client.patch(f"/players/{other_player.id}", json={"first_name": "Iga"})

    assert response.status_code == 404

    saved = db_session.get(Player, other_player.id)
    assert saved is not None
    assert saved.first_name == "Coco"


@pytest.mark.usefixtures("coach")
def test_update_player_unknown_id_is_404(client: TestClient) -> None:
    response = client.patch(f"/players/{uuid.uuid4()}", json={"first_name": "Iga"})

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/players"),
        ("get", "/players"),
        ("get", f"/players/{uuid.UUID(int=0)}"),
        ("patch", f"/players/{uuid.UUID(int=0)}"),
    ],
)
def test_player_routes_require_a_session(client: TestClient, method: str, path: str) -> None:
    """No cookie, no roster: every player route answers 401 before anything else —
    including validation, which is why the writes can send an empty body."""
    response = client.request(method, path, json={} if method in {"post", "patch"} else None)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
