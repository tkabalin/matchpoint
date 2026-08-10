import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.models import Match
from tests.factories import make_match, make_player


def test_create_match_persists_and_returns_row(client: TestClient, db_session: Session) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches",
        json={
            "player_id": str(player.id),
            "opponent_name": "Aryna",
            "played_on": "2026-08-01",
            "surface": "clay",
            "event": "Roland-Garros",
            "format": "best_of_3",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["player_id"] == str(player.id)
    assert body["opponent_name"] == "Aryna"
    assert body["played_on"] == "2026-08-01"
    assert body["surface"] == "clay"
    assert body["event"] == "Roland-Garros"
    assert body["format"] == "best_of_3"

    saved = db_session.get(Match, uuid.UUID(body["id"]))
    assert saved is not None
    assert saved.played_on == date(2026, 8, 1)


def test_create_match_with_only_the_required_fields(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches", json={"player_id": str(player.id), "played_on": "2026-08-01"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["opponent_name"] is None
    assert body["surface"] is None
    assert body["event"] is None
    assert body["format"] is None


def test_create_match_rejects_unknown_player(client: TestClient, db_session: Session) -> None:
    """404 rather than 422: FastAPI declares that status as HTTPValidationError, whose
    detail is a list, and the generated TypeScript client unpacks it as one."""
    response = client.post(
        "/matches",
        json={"player_id": str(uuid.uuid4()), "played_on": "2026-08-01"},
    )

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


def test_create_match_rejects_missing_player_id(client: TestClient) -> None:
    response = client.post("/matches", json={"played_on": "2026-08-01"})

    assert response.status_code == 422


def test_create_match_rejects_a_malformed_player_id(client: TestClient) -> None:
    """Fails body validation before the handler's existence check, so it is a 422 and
    not the 404 an unknown but well-formed id gets."""
    response = client.post("/matches", json={"player_id": "not-a-uuid", "played_on": "2026-08-01"})

    assert response.status_code == 422


def test_create_match_rejects_missing_played_on(client: TestClient, db_session: Session) -> None:
    player = make_player(db_session)

    response = client.post("/matches", json={"player_id": str(player.id)})

    assert response.status_code == 422


def test_create_match_rejects_a_malformed_played_on(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches", json={"player_id": str(player.id), "played_on": "01-08-2026"}
    )

    assert response.status_code == 422


def test_create_match_rejects_a_future_played_on(client: TestClient, db_session: Session) -> None:
    tomorrow = date.today() + timedelta(days=1)

    response = client.post(
        "/matches",
        json={"player_id": str(make_player(db_session).id), "played_on": tomorrow.isoformat()},
    )

    assert response.status_code == 422


def test_create_match_accepts_a_played_on_of_today(client: TestClient, db_session: Session) -> None:
    """The common case, since capture starts courtside — so the future bound must not
    swallow it."""
    today = date.today()

    response = client.post(
        "/matches",
        json={"player_id": str(make_player(db_session).id), "played_on": today.isoformat()},
    )

    assert response.status_code == 201
    assert response.json()["played_on"] == today.isoformat()


def test_create_match_rejects_an_implausibly_old_played_on(
    client: TestClient, db_session: Session
) -> None:
    response = client.post(
        "/matches",
        json={"player_id": str(make_player(db_session).id), "played_on": "1999-01-01"},
    )

    assert response.status_code == 422


def test_create_match_rejects_an_invalid_surface(client: TestClient, db_session: Session) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches",
        json={"player_id": str(player.id), "played_on": "2026-08-01", "surface": "moon dust"},
    )

    assert response.status_code == 422


def test_create_match_rejects_an_invalid_format(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session).id),
            "played_on": "2026-08-01",
            "format": "best_of_2",
        },
    )

    assert response.status_code == 422


def test_create_match_rejects_a_whitespace_only_opponent_name(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches",
        json={"player_id": str(player.id), "played_on": "2026-08-01", "opponent_name": "   "},
    )

    assert response.status_code == 422


def test_create_match_rejects_an_overlong_opponent_name(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches",
        json={"player_id": str(player.id), "played_on": "2026-08-01", "opponent_name": "x" * 101},
    )

    assert response.status_code == 422


def test_create_match_accepts_free_text_at_the_length_limit(
    client: TestClient, db_session: Session
) -> None:
    """Pairs with the test above so the boundary is pinned from both sides — an
    off-by-one in ShortText would otherwise pass."""
    player = make_player(db_session)
    at_limit = "x" * 100

    response = client.post(
        "/matches",
        json={
            "player_id": str(player.id),
            "played_on": "2026-08-01",
            "opponent_name": at_limit,
            "event": at_limit,
        },
    )

    assert response.status_code == 201
    assert response.json()["opponent_name"] == at_limit
    assert response.json()["event"] == at_limit


def test_create_match_strips_surrounding_whitespace(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)

    response = client.post(
        "/matches",
        json={
            "player_id": str(player.id),
            "played_on": "2026-08-01",
            "opponent_name": "  Aryna  ",
            "event": "  Roland-Garros  ",
        },
    )

    assert response.status_code == 201
    assert response.json()["opponent_name"] == "Aryna"
    assert response.json()["event"] == "Roland-Garros"


def test_list_matches_newest_first(client: TestClient, db_session: Session) -> None:
    player = make_player(db_session)
    older = make_match(db_session, player_id=player.id, played_on=date(2026, 7, 1))
    newer = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(newer.id), str(older.id)]


def test_list_matches_breaks_same_day_ties_by_creation_order(
    client: TestClient, db_session: Session
) -> None:
    player = make_player(db_session)
    first = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    second = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(second.id), str(first.id)]


def test_list_matches_spans_every_player(client: TestClient, db_session: Session) -> None:
    """Unfiltered unless asked: the player_id filter is opt-in, and a list that scoped
    itself silently would look identical in every other test here."""
    make_match(db_session, played_on=date(2026, 8, 1))
    make_match(db_session, played_on=date(2026, 8, 2))
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_matches_filtered_by_player(client: TestClient, db_session: Session) -> None:
    """The other player's match is the newer one, so a filter that was ignored fails
    this on order as well as on length."""
    player = make_player(db_session)
    theirs = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    make_match(db_session, played_on=date(2026, 8, 2))
    db_session.commit()

    response = client.get("/matches", params={"player_id": str(player.id)})

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(theirs.id)]


def test_list_matches_filtered_by_an_unknown_player_is_empty(
    client: TestClient, db_session: Session
) -> None:
    """A filter matching nothing is an empty list, not the 404 an unknown id gets on
    the create and get routes — the player is a filter here, not the resource."""
    make_match(db_session, played_on=date(2026, 8, 1))
    db_session.commit()

    response = client.get("/matches", params={"player_id": str(uuid.uuid4())})

    assert response.status_code == 200
    assert response.json() == []


def test_list_matches_rejects_a_malformed_player_id(client: TestClient) -> None:
    response = client.get("/matches", params={"player_id": "not-a-uuid"})

    assert response.status_code == 422


def test_list_matches_with_none_stored_is_an_empty_list(client: TestClient) -> None:
    response = client.get("/matches")

    assert response.status_code == 200
    assert response.json() == []


def test_get_match_returns_one(client: TestClient, db_session: Session) -> None:
    match = make_match(db_session, opponent_name="Aryna")
    db_session.commit()

    response = client.get(f"/matches/{match.id}")

    assert response.status_code == 200
    assert response.json()["opponent_name"] == "Aryna"


def test_get_match_unknown_id_is_404(client: TestClient) -> None:
    response = client.get(f"/matches/{uuid.uuid4()}")

    assert response.status_code == 404


def test_get_match_malformed_id_is_422(client: TestClient) -> None:
    """A non-UUID path segment fails path validation rather than reaching the
    handler, so it is a 422 and not the 404 an unknown id gets."""
    response = client.get("/matches/not-a-uuid")

    assert response.status_code == 422
