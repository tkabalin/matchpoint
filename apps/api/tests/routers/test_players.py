import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient
from psycopg.errors import NotNullViolation, UniqueViolation
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api import photos
from matchpoint_api.auth import new_session_token
from matchpoint_api.models import (
    Coach,
    DeletedMatch,
    DominantHand,
    Match,
    Player,
    PlayerNote,
    PlayerSession,
    PlayerTransferCode,
    Point,
    ScoreCheckpoint,
)
from matchpoint_api.routers import players as players_module
from matchpoint_api.routers.matches import CAPTURE_CLAIM_TTL
from matchpoint_api.routers.players import (
    ALREADY_OWNED,
    TRANSFER_CODES_OUTSTANDING,
    UNKNOWN_TRANSFER_CODE,
)
from matchpoint_api.security import verify_password
from tests.conftest import (
    ORIGIN_HEADERS,
    TEST_ORIGIN,
    Clock,
    breach_every_password,
    image_bytes,
    stored_photos,
)
from tests.factories import (
    make_coach,
    make_match,
    make_player,
    make_player_note,
    make_player_session,
    make_player_transfer_code,
    make_point,
    make_score_checkpoint,
    sign_in,
    sign_in_player,
)

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


def test_create_player_cannot_set_coach_id(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """coach_id is not on PlayerCreate, so RequestModel's extra="forbid" makes sending
    it a 422: a client cannot hand a player to another coach."""
    other = make_coach(db_session)
    db_session.commit()

    response = client.post("/players", json=_payload(coach_id=str(other.id)))

    assert response.status_code == 422
    assert db_session.scalar(select(func.count()).select_from(Player)) == 0


@pytest.mark.usefixtures("coach")
def test_create_player_mints_the_username_and_numbers_namesakes(client: TestClient) -> None:
    """The username is the player's sign-in identifier, so the coach learns it here:
    the create response is the only place it is ever presented as new."""
    first = client.post("/players", json=_payload())
    second = client.post("/players", json=_payload())

    assert first.json()["username"] == "wllser001"
    assert second.json()["username"] == "wllser002"


def test_create_player_numbers_past_usernames_minted_before_this_request(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The number comes off the table, not this request's memory: rows backfilled by
    the migration or created by another coach count the same as this coach's own."""
    make_player(db_session, username="wllser001", coach_id=make_coach(db_session).id)
    db_session.commit()

    response = client.post("/players", json=_payload())

    assert response.json()["username"] == "wllser002"


def test_create_player_returns_a_one_time_password_and_stores_only_its_hash(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The response is the only place the password ever appears: the row keeps an
    Argon2 hash, so nothing can show it a second time."""
    response = client.post("/players", json=_payload())

    password = response.json()["password"]
    saved = db_session.get(Player, uuid.UUID(response.json()["id"]))
    assert saved is not None
    assert saved.password_hash is not None
    assert saved.password_hash.startswith("$argon2")
    assert password not in saved.password_hash
    assert verify_password(password, saved.password_hash)


def test_the_password_never_appears_on_a_read(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """PlayerRead has no password field at all, so the list and the profile cannot
    leak one however the row was minted."""
    created = client.post("/players", json=_payload()).json()

    fetched = client.get(f"/players/{created['id']}").json()
    listed = client.get("/players").json()

    assert "password" not in fetched
    assert all("password" not in player for player in listed)


@pytest.mark.usefixtures("coach")
def test_the_minted_password_never_meets_the_policy(client: TestClient) -> None:
    """A uniform draw cannot fail rules built for human choices, so the policy and the
    breach corpus are deliberately never consulted: a corpus that refuses everything
    must not be able to refuse a create."""
    breach_every_password(client)

    assert client.post("/players", json=_payload()).status_code == 201


def test_creates_beyond_the_minting_burst_are_refused(
    client: TestClient,
    db_session: Session,
    coach: Coach,
    monkeypatch: pytest.MonkeyPatch,
    clock: Clock,
) -> None:
    """Every create now pays an Argon2 hash, so arrivals are metered like photo
    uploads. The burst is sized past any club roster, which is the point of it:
    hashing is stubbed to keep the drain cheap, since the tier is what is under test."""
    monkeypatch.setattr(players_module, "hash_password", lambda password: "$argon2-stub")
    for _ in range(60):
        assert client.post("/players", json=_payload()).status_code == 201

    refused = client.post("/players", json=_payload())

    assert refused.status_code == 429
    assert refused.headers["Retry-After"].isdigit()


def test_create_player_retries_when_a_concurrent_create_takes_the_username(
    client: TestClient, db_session: Session, coach: Coach, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two creates of namesakes can both compute the same number; the loser must mint
    the next one rather than surface the collision. The race itself needs two
    interleaved transactions, so the first computation is doctored to the taken value
    and the second left to do what the loser's retry really does."""
    make_player(db_session, username="wllser001")
    db_session.commit()
    real = players_module.next_username
    minted = iter(["wllser001"])
    monkeypatch.setattr(
        players_module,
        "next_username",
        lambda db, first, last: next(minted, None) or real(db, first, last),
    )

    response = client.post("/players", json=_payload())

    assert response.status_code == 201
    assert response.json()["username"] == "wllser002"


def test_create_player_gives_up_after_three_username_collisions(
    client: TestClient, db_session: Session, coach: Coach, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The bound exists so a bug that always computes a taken name cannot loop; past
    it the violation surfaces as the server error it is, not as a 409 blaming the
    coach's choice of name, and there was no choice."""
    make_player(db_session, username="wllser001")
    db_session.commit()
    monkeypatch.setattr(players_module, "next_username", lambda db, first, last: "wllser001")

    with pytest.raises(IntegrityError) as caught:
        client.post("/players", json=_payload())

    assert isinstance(caught.value.orig, UniqueViolation)


def test_regenerating_gives_a_backfilled_player_a_password_that_signs_them_in(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The whole recovery path in one pass: a row with no credential (every player
    from before sign-ins existed) gets one minted, the coach reads both halves off
    the response, and the player's login works. Players have no email, so this
    route is their only way in or back in."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    assert player.password_hash is None

    response = client.post(f"/players/{player.id}/password")

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == player.username
    login_client = TestClient(client.app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS)
    login = login_client.post(
        "/auth/player/login",
        json={"username": body["username"], "password": body["password"]},
    )
    assert login.status_code == 200


def test_regenerating_stores_only_a_hash_and_replaces_the_old_password(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One credential at a time: the row keeps one Argon2, so minting again is also
    the revocation of whatever the old password could still do at the login form."""
    created = client.post("/players", json=_payload()).json()

    regenerated = client.post(f"/players/{created['id']}/password").json()

    saved = db_session.get(Player, uuid.UUID(created["id"]))
    assert saved is not None
    assert saved.password_hash is not None
    assert saved.password_hash.startswith("$argon2")
    assert regenerated["password"] not in saved.password_hash
    login_client = TestClient(client.app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS)
    old = login_client.post(
        "/auth/player/login",
        json={"username": created["username"], "password": created["password"]},
    )
    new = login_client.post(
        "/auth/player/login",
        json={"username": regenerated["username"], "password": regenerated["password"]},
    )
    assert old.status_code == 401
    assert new.status_code == 200


def test_regenerating_ends_the_player_s_live_sessions_and_no_one_else_s(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The coach's takeover lever: if the old password or a device is in the wrong
    hands, minting afresh ends everything the old credential had open."""
    player = make_player(db_session, coach_id=coach.id)
    make_player_session(db_session, player_id=player.id)
    make_player_session(db_session, player_id=player.id)
    bystander = make_player_session(db_session)
    db_session.commit()

    response = client.post(f"/players/{player.id}/password")

    assert response.status_code == 201
    remaining = list(db_session.scalars(select(PlayerSession.id)))
    assert remaining == [bystander.id]


def test_regenerating_another_coach_s_player_is_the_404_an_unknown_id_gets(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A password mint is a takeover of the player's sign-in, so the ownership
    boundary here is the same one every player route holds, indistinguishably."""
    other = make_player(db_session)
    db_session.commit()

    foreign = client.post(f"/players/{other.id}/password")
    unknown = client.post(f"/players/{uuid.uuid4()}/password")

    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json() == unknown.json()
    refreshed = db_session.get(Player, other.id)
    assert refreshed is not None
    assert refreshed.password_hash is None


def test_a_404_from_the_password_route_spends_no_minting_token(
    client: TestClient, db_session: Session, coach: Coach, clock: Clock
) -> None:
    """The tier is charged after the ownership check, so ids that are not this coach's
    cannot hold the shared bucket drained and refuse every other coach's creations.
    Past the per-coach burst, which is what a charged 404 would have spent."""
    other = make_player(db_session)
    db_session.commit()
    for _ in range(61):
        assert client.post(f"/players/{other.id}/password").status_code == 404

    assert client.post("/players", json=_payload()).status_code == 201


def test_creation_and_regeneration_spend_the_same_minting_budget(
    client: TestClient,
    db_session: Session,
    coach: Coach,
    monkeypatch: pytest.MonkeyPatch,
    clock: Clock,
) -> None:
    """One tier for the two routes that pay an Argon2 hash, so neither is a way
    around the other's bound. Hashing is stubbed for volume, as the create test."""
    monkeypatch.setattr(players_module, "hash_password", lambda password: "$argon2-stub")
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    for _ in range(60):
        assert client.post(f"/players/{player.id}/password").status_code == 201

    refused = client.post("/players", json=_payload())

    assert refused.status_code == 429


def test_create_player_re_raises_an_integrity_error_that_is_not_the_username(
    client: TestClient, db_session: Session, coach: Coach, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only the unique username is retried. Any other integrity failure is a bug, and
    retrying it would run the same bug three times before surfacing it anyway."""
    monkeypatch.setattr(players_module, "next_username", lambda db, first, last: None)

    with pytest.raises(IntegrityError) as caught:
        client.post("/players", json=_payload())

    assert isinstance(caught.value.orig, NotNullViolation)


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


def test_update_player_rejects_coach_id(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """coach_id is not on PlayerUpdate, so RequestModel's extra="forbid" makes sending
    it a 422: a PATCH cannot hand a player to another coach."""
    other = make_coach(db_session)
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.patch(f"/players/{player.id}", json={"coach_id": str(other.id)})

    assert response.status_code == 422
    assert player.coach_id == coach.id


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


def test_delete_player_takes_their_matches_with_them(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A hard delete, and the whole of it: the row goes, the matches recorded against it
    go, the sessions the player could still sign in on go, and neither the roster nor
    the lookup has anything left to answer with."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    player_session = make_player_session(db_session, player_id=player.id)
    db_session.commit()

    response = client.delete(f"/players/{player.id}")

    assert response.status_code == 204
    assert db_session.get(Player, player.id) is None
    assert db_session.get(Match, match.id) is None
    assert db_session.get(PlayerSession, player_session.id) is None
    assert client.get("/players").json() == []
    assert client.get(f"/players/{player.id}").status_code == 404


def test_delete_player_takes_their_matches_points_with_them(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The points a match's own delete route would refuse over go with the player
    instead: this delete means to take the whole roster history, and a foreign key
    that refused them here would stop the player delete outright rather than being
    quietly missed."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    point = make_point(db_session, match_id=match.id)
    checkpoint = make_score_checkpoint(db_session, match_id=match.id)
    db_session.commit()

    response = client.delete(f"/players/{player.id}")

    assert response.status_code == 204
    assert db_session.get(Match, match.id) is None
    assert db_session.get(Point, point.id) is None
    assert db_session.get(ScoreCheckpoint, checkpoint.id) is None


def test_delete_player_takes_a_match_being_captured_with_it(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The refusal a live capture claim puts on the match's own delete route stops
    there. A transfer code is another coach's pending claim, which is why it refuses on
    every route that reaches the row; a capture claim is this coach's own device holding
    their own data, and erasing the player is a deliberate act, not a stray tap."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(
        db_session,
        player_id=player.id,
        capture_claim_device_id=uuid.uuid4(),
        capture_claim_expires_at=datetime.now(UTC) + CAPTURE_CLAIM_TTL,
    )
    db_session.commit()

    assert client.delete(f"/players/{player.id}").status_code == 204
    assert db_session.get(Match, match.id) is None


def test_delete_player_records_the_ids_of_the_matches_it_freed(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """What a match's own delete route writes, written here too and once per match (#243).
    Without it a create or point flush queued offline for one of them answers 404, which
    the sync layer parks as a failure the coach can never clear, for data they chose to
    destroy."""
    player = make_player(db_session, coach_id=coach.id)
    match_ids = [make_match(db_session, player_id=player.id).id for _ in range(2)]
    db_session.commit()

    assert client.delete(f"/players/{player.id}").status_code == 204

    for match_id in match_ids:
        recorded = db_session.get(DeletedMatch, match_id)
        assert recorded is not None
        assert recorded.coach_id == coach.id
        assert recorded.deleted_at > datetime.now(UTC) - timedelta(minutes=1)


def test_delete_player_with_no_matches_records_nothing(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The ids remembered are the ids erased, so a roster entry that never played leaves
    nothing behind to sit out its window."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    assert client.delete(f"/players/{player.id}").status_code == 204

    assert db_session.scalar(select(func.count()).select_from(DeletedMatch)) == 0


def test_delete_player_leaves_the_rest_of_the_roster_alone(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The cascade is scoped to the one player, which the coach-boundary test cannot
    show: it never reaches the delete. A match statement missing its player_id clause
    would clear the whole table and still pass every other test here."""
    player = make_player(db_session, coach_id=coach.id)
    make_match(db_session, player_id=player.id)
    kept = make_player(db_session, coach_id=coach.id)
    kept_match = make_match(db_session, player_id=kept.id)
    db_session.commit()

    assert client.delete(f"/players/{player.id}").status_code == 204

    assert db_session.get(Player, kept.id) is not None
    assert db_session.get(Match, kept_match.id) is not None


def test_delete_player_is_refused_while_a_transfer_code_is_outstanding(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A live code is another coach's pending claim, so the player is not this coach's
    alone to erase (#173). The body is asserted exactly because the route declares the
    409 as ErrorDetail for the roster screen to branch on."""
    player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    db_session.commit()
    _mint(client, player.id)

    response = client.delete(f"/players/{player.id}")

    assert response.status_code == 409
    assert response.json() == {"detail": TRANSFER_CODES_OUTSTANDING}
    assert db_session.get(Player, player.id) is not None
    assert db_session.get(Match, match.id) is not None


def test_cancelling_the_code_clears_the_way_for_the_delete(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The way past the refusal, and the reason it costs the coach only one request:
    the same coach who minted the code can withdraw it."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _mint(client, player.id)

    assert client.delete(f"/players/{player.id}/transfer-code").status_code == 204

    assert client.delete(f"/players/{player.id}").status_code == 204
    assert db_session.get(Player, player.id) is None


def test_delete_player_leaves_another_coachs_roster_alone(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The write across the boundary: the same 404 the read gets, since a 403 would
    confirm the id exists, and the row has to come through untouched."""
    other_player = make_player(db_session)
    other_match = make_match(db_session, player_id=other_player.id)
    db_session.commit()

    response = client.delete(f"/players/{other_player.id}")

    assert response.status_code == 404
    assert db_session.get(Player, other_player.id) is not None
    assert db_session.get(Match, other_match.id) is not None


@pytest.mark.usefixtures("coach")
def test_delete_player_unknown_id_is_404(client: TestClient) -> None:
    response = client.delete(f"/players/{uuid.uuid4()}")

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/players"),
        ("get", "/players"),
        ("get", f"/players/{uuid.UUID(int=0)}"),
        ("patch", f"/players/{uuid.UUID(int=0)}"),
        ("delete", f"/players/{uuid.UUID(int=0)}"),
        ("post", f"/players/{uuid.UUID(int=0)}/transfer-code"),
        ("delete", f"/players/{uuid.UUID(int=0)}/transfer-code"),
        ("post", "/players/redeem-transfer-code"),
        ("get", f"/players/{uuid.UUID(int=0)}/notes"),
        ("post", f"/players/{uuid.UUID(int=0)}/notes"),
        ("patch", f"/players/{uuid.UUID(int=0)}/notes/{uuid.UUID(int=0)}"),
        ("delete", f"/players/{uuid.UUID(int=0)}/notes/{uuid.UUID(int=0)}"),
    ],
)
def test_player_routes_require_a_session(client: TestClient, method: str, path: str) -> None:
    """No cookie, no roster: every player route answers 401 before anything else —
    including validation, which is why the writes can send an empty body."""
    response = client.request(method, path, json={} if method in {"post", "patch"} else None)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


# Transferring a player (#173). The mint is driven through the route wherever a test
# needs a code it can redeem, since the plaintext exists only in that response.


def _mint(client: TestClient, player_id: uuid.UUID) -> str:
    response = client.post(f"/players/{player_id}/transfer-code")
    assert response.status_code == 201
    return str(response.json()["code"])


def test_a_transfer_code_moves_the_player_and_their_matches(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The whole point of the flow: the new coach gets the history, and the old one
    stops seeing the player at all. Matches need no rewriting of their own, reaching
    their owner through the player they were recorded against."""
    player = make_player(db_session, last_name="Barty", coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    db_session.commit()
    code = _mint(client, player.id)

    new_coach = make_coach(db_session)
    sign_in(client, db_session, new_coach)
    response = client.post("/players/redeem-transfer-code", json={"code": code})

    assert response.status_code == 200
    assert response.json()["coach_id"] == str(new_coach.id)
    assert [p["last_name"] for p in client.get("/players").json()] == ["Barty"]
    assert [m["id"] for m in client.get("/matches").json()] == [str(match.id)]

    sign_in(client, db_session, coach)
    assert client.get("/players").json() == []


def test_a_pasted_code_may_carry_whitespace(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The code travels through a chat message, so a trailing newline comes with it.
    Answering that with "unknown code" would be a wrong answer to a right code."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    code = _mint(client, player.id)

    sign_in(client, db_session, make_coach(db_session))
    response = client.post("/players/redeem-transfer-code", json={"code": f"  {code}\n"})

    assert response.status_code == 200


def test_minting_again_replaces_the_previous_code(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Only the hash is stored, so a coach who asks twice cannot be shown the first
    code again, which makes replacing it the only honest answer."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    first = _mint(client, player.id)

    second = _mint(client, player.id)

    assert second != first
    sign_in(client, db_session, make_coach(db_session))
    assert client.post("/players/redeem-transfer-code", json={"code": first}).status_code == 400
    assert client.post("/players/redeem-transfer-code", json={"code": second}).status_code == 200


def test_a_redeemed_code_cannot_be_used_again(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Single use: the code is spent on the transfer, so a copy of it left in a chat
    log cannot take the player back off the coach who now has them."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    code = _mint(client, player.id)
    sign_in(client, db_session, make_coach(db_session))
    assert client.post("/players/redeem-transfer-code", json={"code": code}).status_code == 200

    sign_in(client, db_session, make_coach(db_session))
    response = client.post("/players/redeem-transfer-code", json={"code": code})

    assert response.status_code == 400
    assert response.json() == {"detail": UNKNOWN_TRANSFER_CODE}


@pytest.mark.usefixtures("coach")
def test_redeeming_an_unknown_code_is_400(client: TestClient) -> None:
    response = client.post("/players/redeem-transfer-code", json={"code": new_session_token()})

    assert response.status_code == 400
    assert response.json() == {"detail": UNKNOWN_TRANSFER_CODE}


def test_redeeming_your_own_code_is_409_and_leaves_it_usable(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A coach checking the code they are about to hand over must not spend it, so the
    409 writes nothing."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    code = _mint(client, player.id)

    response = client.post("/players/redeem-transfer-code", json={"code": code})

    assert response.status_code == 409
    assert response.json() == {"detail": ALREADY_OWNED}
    sign_in(client, db_session, make_coach(db_session))
    assert client.post("/players/redeem-transfer-code", json={"code": code}).status_code == 200


def test_deleting_a_transfer_code_stops_it_working(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A code that never expires needs a way back: handing one to the wrong person is
    otherwise permanent."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    code = _mint(client, player.id)

    response = client.delete(f"/players/{player.id}/transfer-code")

    assert response.status_code == 204
    sign_in(client, db_session, make_coach(db_session))
    assert client.post("/players/redeem-transfer-code", json={"code": code}).status_code == 400


def test_deleting_a_transfer_code_that_was_never_minted_is_204(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The request asks for a state, and a player with no live code is already in it:
    logout's reasoning, so a retry is not an error."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.delete(f"/players/{player.id}/transfer-code")

    assert response.status_code == 204


@pytest.mark.parametrize("method", ["post", "delete"])
def test_transfer_code_for_another_coachs_player_is_404(
    client: TestClient, db_session: Session, coach: Coach, method: str
) -> None:
    """Minting is taking a capability over the row, so it stops at the same boundary
    reading it does, and with the same 404 rather than a 403 that confirms the id."""
    other_player = make_player(db_session)
    db_session.commit()

    response = client.request(method, f"/players/{other_player.id}/transfer-code")

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(PlayerTransferCode)) == 0


# Reporting an outstanding code (#189). Three screens branch on it: the pending-transfer
# state a reload has to survive, and the two 409s (this delete and account closure) that
# would otherwise arrive unannounced.


def test_a_freshly_created_player_has_no_transfer_code(client: TestClient, coach: Coach) -> None:
    response = client.post("/players", json=_payload())

    assert response.status_code == 201
    assert response.json()["has_transfer_code"] is False


def test_the_roster_flags_only_the_players_holding_a_code(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """What the roster needs is the answer for every player at once, so the screen can
    mark the one player it must not offer a delete for."""
    make_player_transfer_code(
        db_session,
        player_id=make_player(db_session, last_name="Barty", coach_id=coach.id).id,
    )
    make_player(db_session, last_name="Osaka", coach_id=coach.id)
    db_session.commit()

    response = client.get("/players")

    assert response.status_code == 200
    assert [(p["last_name"], p["has_transfer_code"]) for p in response.json()] == [
        ("Barty", True),
        ("Osaka", False),
    ]


def test_the_roster_reports_every_flag_in_one_statement(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Computed inside the roster's own SELECT rather than looked up per player: a lazy
    load reads the same as this test until the roster is long, and then costs a round
    trip each. Counting statements against the table is what pins that down."""
    for _ in range(3):
        player = make_player(db_session, coach_id=coach.id)
        make_player_transfer_code(db_session, player_id=player.id)
    db_session.commit()
    connection = db_session.connection()
    statements: list[str] = []

    def record(
        _connection: object, _cursor: object, statement: str, *_rest: object, **_kwargs: object
    ) -> None:
        if "player_transfer_codes" in statement:
            statements.append(statement)

    event.listen(connection, "after_cursor_execute", record)
    try:
        response = client.get("/players")
    finally:
        event.remove(connection, "after_cursor_execute", record)

    assert [p["has_transfer_code"] for p in response.json()] == [True, True, True]
    assert len(statements) == 1


def test_minting_a_code_shows_up_on_the_player(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The reload case: the plaintext code exists only in the mint response, so a coach
    who refreshes the page can learn nothing but that one is still outstanding."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    _mint(client, player.id)

    assert client.get(f"/players/{player.id}").json()["has_transfer_code"] is True


def test_cancelling_a_code_clears_the_flag(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Cancel answers 204 whether or not a code was live, so the flag going false is the
    only way the screen can tell the request did anything."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _mint(client, player.id)

    assert client.delete(f"/players/{player.id}/transfer-code").status_code == 204

    assert client.get(f"/players/{player.id}").json()["has_transfer_code"] is False


def test_redeeming_a_code_clears_the_flag_on_the_response(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The redeem response is the new coach's first sight of the player, and the code it
    spent is gone, so the row it returns has to say so rather than repeat what it read
    before the delete."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    code = _mint(client, player.id)

    sign_in(client, db_session, make_coach(db_session))
    response = client.post("/players/redeem-transfer-code", json={"code": code})

    assert response.status_code == 200
    assert response.json()["has_transfer_code"] is False
    assert client.get(f"/players/{player.id}").json()["has_transfer_code"] is False


def test_the_flag_and_the_delete_refusal_agree(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The pair this field exists to keep in step: a player the roster shows as free of a
    code must not answer 409, and one it flags must."""
    flagged = make_player(db_session, coach_id=coach.id)
    free = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _mint(client, flagged.id)

    assert client.get(f"/players/{flagged.id}").json()["has_transfer_code"] is True
    assert client.delete(f"/players/{flagged.id}").status_code == 409
    assert client.get(f"/players/{free.id}").json()["has_transfer_code"] is False
    assert client.delete(f"/players/{free.id}").status_code == 204


# --- Player photos: POST and DELETE /players/{player_id}/photo ---


def _upload(client: TestClient, player_id: uuid.UUID, data: bytes | None = None) -> httpx2.Response:
    return client.post(
        f"/players/{player_id}/photo", files={"file": ("photo.png", data or image_bytes())}
    )


def test_uploading_a_photo_answers_with_the_player(
    client: TestClient, db_session: Session, coach: Coach, media_root: Path
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = _upload(client, player.id)

    assert response.status_code == 200
    assert response.json()["photo_url"] == f"/api/media/{player.photo_key}{photos.EXTENSION}"
    assert len(stored_photos(media_root)) == 1


def test_an_uploaded_photo_is_served_at_the_url_it_reports(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The URL carries /api, stripped by Caddy in production and by the dev proxy
    locally; a test client is fronted by neither, so it asks for what arrives."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    photo_url = _upload(client, player.id).json()["photo_url"]

    response = client.get(photo_url.removeprefix("/api"))

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "image/webp"


def test_replacing_a_photo_removes_the_one_it_replaced(
    client: TestClient, db_session: Session, coach: Coach, media_root: Path
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    first = _upload(client, player.id).json()["photo_url"]

    second = _upload(client, player.id).json()["photo_url"]

    assert first != second
    assert len(stored_photos(media_root)) == 1


def test_clearing_a_photo_removes_the_file(
    client: TestClient, db_session: Session, coach: Coach, media_root: Path
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _upload(client, player.id)

    response = client.delete(f"/players/{player.id}/photo")

    assert response.status_code == 200
    assert response.json()["photo_url"] is None
    assert stored_photos(media_root) == []


def test_clearing_a_photo_that_is_not_there_is_a_no_op(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.delete(f"/players/{player.id}/photo")

    assert response.status_code == 200
    assert response.json()["photo_url"] is None


def test_another_coachs_player_is_a_404_and_stores_nothing(
    client: TestClient, db_session: Session, coach: Coach, media_root: Path
) -> None:
    """Ownership is checked before the decode, so probing another coach's ids cannot
    fill the disk one refused upload at a time."""
    theirs = make_player(db_session, coach_id=make_coach(db_session).id)
    db_session.commit()

    assert _upload(client, theirs.id).status_code == 404
    assert client.delete(f"/players/{theirs.id}/photo").status_code == 404

    assert stored_photos(media_root) == []


def test_a_file_that_is_not_an_image_is_refused(
    client: TestClient, db_session: Session, coach: Coach, media_root: Path
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = _upload(client, player.id, b"this is not an image")

    assert response.status_code == 400
    assert response.json()["detail"] == photos.NOT_AN_IMAGE
    assert stored_photos(media_root) == []


def test_deleting_a_player_removes_their_photo(
    client: TestClient, db_session: Session, coach: Coach, media_root: Path
) -> None:
    """Deleting the row is not enough on its own: nothing else ever points at the file,
    so the route has to take it down itself or it never gets reclaimed."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _upload(client, player.id)

    response = client.delete(f"/players/{player.id}")

    assert response.status_code == 204
    assert stored_photos(media_root) == []


def test_a_transferred_player_keeps_their_photo(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The key rides on the player row, so the photo goes with them to the new coach —
    which is the point of a transfer, the history being what the new coach most needs."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    _upload(client, player.id)
    code = client.post(f"/players/{player.id}/transfer-code").json()["code"]
    new_coach = make_coach(db_session, email="new@example.com")
    sign_in(client, db_session, new_coach)

    response = client.post("/players/redeem-transfer-code", json={"code": code})

    assert response.status_code == 200
    assert response.json()["photo_url"] is not None


# Coach notes (#246). The sheet that writes these had no endpoint behind it, so the
# first test here is the bug it was filed for: a note that does not outlive the page.


def _note_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {"body": "Toss drifted left.", "recorded_on": "2026-08-15"}
    return payload | overrides


def test_a_note_survives_the_write_and_comes_back_on_the_next_read(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """#246 in one test: the note is stored, not held in the tab that wrote it, so the
    read that a reload performs answers with it."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    created = client.post(f"/players/{player.id}/notes", json=_note_payload())

    assert created.status_code == 201
    body = created.json()
    assert body["body"] == "Toss drifted left."
    assert body["recorded_on"] == "2026-08-15"
    assert body["player_id"] == str(player.id)

    reread = client.get(f"/players/{player.id}/notes")
    assert reread.status_code == 200
    assert [note["id"] for note in reread.json()] == [body["id"]]

    saved = db_session.get(PlayerNote, uuid.UUID(body["id"]))
    assert saved is not None
    assert saved.player_id == player.id


def test_create_note_files_it_under_the_areas_sent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Filed in the enum's order rather than the order they were tapped, so the same
    two areas always read back the same way."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.post(
        f"/players/{player.id}/notes", json=_note_payload(focus_areas=["mental", "technical"])
    )

    assert response.status_code == 201
    assert response.json()["focus_areas"] == ["technical", "mental"]


def test_create_note_defaults_to_no_focus_areas(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The quick-note path: a body, a date, and nothing else to tap."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.post(f"/players/{player.id}/notes", json=_note_payload())

    assert response.status_code == 201
    assert response.json()["focus_areas"] == []


def test_create_note_cannot_name_a_player_in_the_body(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The note's player is the path and nothing else, which is what makes the splat in
    the route safe: a body naming one is a 422 from extra="forbid"."""
    player = make_player(db_session, coach_id=coach.id)
    other = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.post(
        f"/players/{player.id}/notes", json=_note_payload(player_id=str(other.id))
    )

    assert response.status_code == 422


def test_create_note_against_another_coachs_player_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The ownership 404 every player route answers, and it stores nothing."""
    theirs = make_player(db_session)
    db_session.commit()

    response = client.post(f"/players/{theirs.id}/notes", json=_note_payload())

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(PlayerNote)) == 0


def test_list_notes_is_newest_session_first(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Ordered by the session the note is about, not by when it was typed: a note
    written today about last week's session belongs under this week's."""
    player = make_player(db_session, coach_id=coach.id)
    make_player_note(db_session, player_id=player.id, body="Older", recorded_on=date(2026, 8, 1))
    make_player_note(db_session, player_id=player.id, body="Newer", recorded_on=date(2026, 8, 20))
    make_player_note(db_session, player_id=player.id, body="Middle", recorded_on=date(2026, 8, 10))
    db_session.commit()

    response = client.get(f"/players/{player.id}/notes")

    assert response.status_code == 200
    assert [note["body"] for note in response.json()] == ["Newer", "Middle", "Older"]


def test_list_notes_breaks_a_tie_on_when_the_note_was_written(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two notes about one session come back newest-written first, which is why the
    created_at default is clock_timestamp() and not now()."""
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()
    first = client.post(f"/players/{player.id}/notes", json=_note_payload(body="First"))
    second = client.post(f"/players/{player.id}/notes", json=_note_payload(body="Second"))

    response = client.get(f"/players/{player.id}/notes")

    assert response.status_code == 200
    assert [note["id"] for note in response.json()] == [
        second.json()["id"],
        first.json()["id"],
    ]


def test_list_notes_carries_only_this_players_notes(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One roster, two players: a note is about the player it names, so the other's
    must be absent outright rather than merely ordered elsewhere."""
    player = make_player(db_session, coach_id=coach.id)
    stablemate = make_player(db_session, coach_id=coach.id)
    make_player_note(db_session, player_id=player.id, body="Theirs")
    make_player_note(db_session, player_id=stablemate.id, body="Somebody else's")
    db_session.commit()

    response = client.get(f"/players/{player.id}/notes")

    assert response.status_code == 200
    assert [note["body"] for note in response.json()] == ["Theirs"]


def test_list_notes_with_none_written_is_an_empty_list(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.get(f"/players/{player.id}/notes")

    assert response.status_code == 200
    assert response.json() == []


def test_list_notes_of_another_coachs_player_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A coach's notes are the most private thing on the player: the ownership 404 has
    to answer before any of them is read."""
    theirs = make_player(db_session)
    make_player_note(db_session, player_id=theirs.id)
    db_session.commit()

    response = client.get(f"/players/{theirs.id}/notes")

    assert response.status_code == 404


def test_update_note_changes_only_the_fields_sent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """exclude_unset again: the date is absent from the body, so editing the wording
    leaves the session the note is about where it was."""
    player = make_player(db_session, coach_id=coach.id)
    note = make_player_note(
        db_session,
        player_id=player.id,
        body="Toss drifted left.",
        recorded_on=date(2026, 8, 15),
        focus_areas=["technical"],
    )
    db_session.commit()
    # Read before the request, as the player's own PATCH test reads it: the route shares
    # this session, so afterwards the attribute already holds the value being asserted
    # against. Nothing in the route touches updated_at, so this pins the column's
    # onupdate as what moves it.
    before = note.updated_at

    response = client.patch(
        f"/players/{player.id}/notes/{note.id}", json={"body": "Toss drifted left all session."}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["body"] == "Toss drifted left all session."
    assert body["recorded_on"] == "2026-08-15"
    assert body["focus_areas"] == ["technical"]
    assert datetime.fromisoformat(body["updated_at"]) > before

    saved = db_session.get(PlayerNote, note.id)
    assert saved is not None
    assert saved.body == "Toss drifted left all session."


def test_update_note_clears_the_focus_areas_with_an_empty_list(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Empty is how a coach unfiles a note, null being a 422 over a NOT NULL column."""
    player = make_player(db_session, coach_id=coach.id)
    note = make_player_note(db_session, player_id=player.id, focus_areas=["mental"])
    db_session.commit()

    response = client.patch(f"/players/{player.id}/notes/{note.id}", json={"focus_areas": []})

    assert response.status_code == 200
    assert response.json()["focus_areas"] == []


def test_update_note_of_another_coachs_player_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    theirs = make_player(db_session)
    note = make_player_note(db_session, player_id=theirs.id, body="Theirs")
    db_session.commit()

    response = client.patch(f"/players/{theirs.id}/notes/{note.id}", json={"body": "Rewritten"})

    assert response.status_code == 404
    saved = db_session.get(PlayerNote, note.id)
    assert saved is not None
    assert saved.body == "Theirs"


def test_a_note_reached_through_the_wrong_player_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Both players are this coach's, so ownership alone would let the note through: a
    note is addressed by player and id together, and the pair has to agree."""
    player = make_player(db_session, coach_id=coach.id)
    stablemate = make_player(db_session, coach_id=coach.id)
    note = make_player_note(db_session, player_id=stablemate.id)
    db_session.commit()

    assert client.get(f"/players/{player.id}/notes").json() == []
    assert client.patch(f"/players/{player.id}/notes/{note.id}", json={}).status_code == 404
    assert client.delete(f"/players/{player.id}/notes/{note.id}").status_code == 404


def test_delete_note_removes_it_and_leaves_the_rest(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    doomed = make_player_note(db_session, player_id=player.id, body="Wrong player")
    make_player_note(db_session, player_id=player.id, body="Keep")
    db_session.commit()

    response = client.delete(f"/players/{player.id}/notes/{doomed.id}")

    assert response.status_code == 204
    assert db_session.get(PlayerNote, doomed.id) is None
    assert [note["body"] for note in client.get(f"/players/{player.id}/notes").json()] == ["Keep"]


def test_delete_note_unknown_id_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.delete(f"/players/{player.id}/notes/{uuid.uuid4()}")

    assert response.status_code == 404


def test_delete_player_takes_their_notes_with_them(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The foreign key declares no ondelete, so a note left behind would stop the
    player delete outright rather than be orphaned by it."""
    player = make_player(db_session, coach_id=coach.id)
    note = make_player_note(db_session, player_id=player.id)
    db_session.commit()

    response = client.delete(f"/players/{player.id}")

    assert response.status_code == 204
    assert db_session.get(PlayerNote, note.id) is None


def test_a_transferred_player_keeps_their_notes(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Notes reach their coach through the player, so they move with them, which is
    what `POST /players/{id}/transfer-code` already promises, the history being what
    the new coach most needs."""
    player = make_player(db_session, coach_id=coach.id)
    make_player_note(db_session, player_id=player.id, body="Serve +1 pattern is landing.")
    db_session.commit()
    code = _mint(client, player.id)
    new_coach = make_coach(db_session)
    sign_in(client, db_session, new_coach)

    assert client.post("/players/redeem-transfer-code", json={"code": code}).status_code == 200

    notes = client.get(f"/players/{player.id}/notes")
    assert notes.status_code == 200
    assert [note["body"] for note in notes.json()] == ["Serve +1 pattern is landing."]


# The player principal reads its own matches and statistics and no part of this
# router: the roster is other people's rows, and the profile and the note timeline
# carry the coach's own columns, which docs/security.md keeps on the coach's side of
# the line. Their own profile is GET /auth/player/me, in the shape written for them.


@pytest.mark.parametrize("suffix", ["", "/notes"])
def test_a_player_session_cannot_read_its_own_player_row(
    client: TestClient, db_session: Session, suffix: str
) -> None:
    """Their own id, which is the case that decides it: the refusal is about the
    columns these answer with, not about whose row it is."""
    player = make_player(db_session)
    sign_in_player(client, db_session, player)

    response = client.get(f"/players/{player.id}{suffix}")

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_a_player_session_cannot_read_the_roster(client: TestClient, db_session: Session) -> None:
    player = make_player(db_session)
    sign_in_player(client, db_session, player)

    response = client.get("/players")

    assert response.status_code == 401
