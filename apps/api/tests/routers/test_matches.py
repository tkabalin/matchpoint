import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.models import Coach, Match, Surface
from tests.factories import make_coach, make_match, make_player, sign_in


@pytest.fixture
def coach(client: TestClient, db_session: Session) -> Coach:
    """The coach the client is signed in as.

    Every match route requires a session, so even the pure-validation tests take this
    fixture — without it the dependency's 401 would answer before the 422 they are
    about."""
    coach = make_coach(db_session)
    sign_in(client, db_session, coach)
    return coach


def test_create_match_persists_and_returns_row(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post(
        "/matches",
        json={
            "player_id": str(player.id),
            "opponent_name": "Aryna",
            "played_on": "2026-08-01",
            "surface": "clay",
            "event": "Roland-Garros",
            "sets_format": "best_of_3",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["player_id"] == str(player.id)
    assert body["opponent_name"] == "Aryna"
    assert body["played_on"] == "2026-08-01"
    assert body["surface"] == "clay"
    assert body["event"] == "Roland-Garros"
    assert body["sets_format"] == "best_of_3"

    saved = db_session.get(Match, uuid.UUID(body["id"]))
    assert saved is not None
    assert saved.played_on == date(2026, 8, 1)


def test_create_match_with_only_the_required_fields(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post(
        "/matches", json={"player_id": str(player.id), "played_on": "2026-08-01"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["opponent_name"] is None
    assert body["surface"] is None
    assert body["event"] is None
    assert body["sets_format"] is None


@pytest.mark.usefixtures("coach")
def test_create_match_rejects_unknown_player(client: TestClient, db_session: Session) -> None:
    """404 rather than 422: FastAPI declares that status as HTTPValidationError, whose
    detail is a list, and the generated TypeScript client unpacks it as one."""
    response = client.post(
        "/matches",
        json={"player_id": str(uuid.uuid4()), "played_on": "2026-08-01"},
    )

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


def test_create_match_against_another_coachs_player_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The write across the boundary: without an owner check a coach could attach a
    match to someone else's player. The same 404 an unknown id gets, and not a 403 —
    a 403 would confirm the player exists."""
    other_player = make_player(db_session)
    db_session.commit()

    response = client.post(
        "/matches",
        json={"player_id": str(other_player.id), "played_on": "2026-08-01"},
    )

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


@pytest.mark.usefixtures("coach")
def test_create_match_rejects_missing_player_id(client: TestClient) -> None:
    response = client.post("/matches", json={"played_on": "2026-08-01"})

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_create_match_rejects_a_malformed_player_id(client: TestClient) -> None:
    """Fails body validation before the handler's existence check, so it is a 422 and
    not the 404 an unknown but well-formed id gets."""
    response = client.post("/matches", json={"player_id": "not-a-uuid", "played_on": "2026-08-01"})

    assert response.status_code == 422


def test_create_match_rejects_missing_played_on(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post("/matches", json={"player_id": str(player.id)})

    assert response.status_code == 422


def test_create_match_rejects_a_malformed_played_on(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post(
        "/matches", json={"player_id": str(player.id), "played_on": "01-08-2026"}
    )

    assert response.status_code == 422


def test_create_match_rejects_a_future_played_on(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    tomorrow = date.today() + timedelta(days=1)

    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session, coach_id=coach.id).id),
            "played_on": tomorrow.isoformat(),
        },
    )

    assert response.status_code == 422


def test_create_match_accepts_a_played_on_of_today(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The common case, since capture starts courtside — so the future bound must not
    swallow it."""
    today = date.today()

    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session, coach_id=coach.id).id),
            "played_on": today.isoformat(),
        },
    )

    assert response.status_code == 201
    assert response.json()["played_on"] == today.isoformat()


def test_create_match_rejects_an_implausibly_old_played_on(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session, coach_id=coach.id).id),
            "played_on": "1999-01-01",
        },
    )

    assert response.status_code == 422


def test_create_match_rejects_an_invalid_surface(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post(
        "/matches",
        json={"player_id": str(player.id), "played_on": "2026-08-01", "surface": "moon dust"},
    )

    assert response.status_code == 422


def test_create_match_rejects_an_invalid_sets_format(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session, coach_id=coach.id).id),
            "played_on": "2026-08-01",
            "sets_format": "best_of_2",
        },
    )

    assert response.status_code == 422


def test_create_match_rejects_a_whitespace_only_opponent_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post(
        "/matches",
        json={"player_id": str(player.id), "played_on": "2026-08-01", "opponent_name": "   "},
    )

    assert response.status_code == 422


def test_create_match_rejects_an_overlong_opponent_name(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

    response = client.post(
        "/matches",
        json={"player_id": str(player.id), "played_on": "2026-08-01", "opponent_name": "x" * 101},
    )

    assert response.status_code == 422


def test_create_match_accepts_free_text_at_the_length_limit(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Pairs with the test above so the boundary is pinned from both sides — an
    off-by-one in ShortText would otherwise pass."""
    player = make_player(db_session, coach_id=coach.id)
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
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)

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


def test_list_matches_newest_first(client: TestClient, db_session: Session, coach: Coach) -> None:
    player = make_player(db_session, coach_id=coach.id)
    older = make_match(db_session, player_id=player.id, played_on=date(2026, 7, 1))
    newer = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(newer.id), str(older.id)]


def test_list_matches_breaks_same_day_ties_by_creation_order(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    first = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    second = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(second.id), str(first.id)]


def test_list_matches_spans_every_player_of_the_caller(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Unfiltered unless asked: the player_id filter is opt-in, so the list crosses
    the caller's whole roster — that is the recent activity the dashboard opens on."""
    make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        played_on=date(2026, 8, 1),
    )
    make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        played_on=date(2026, 8, 2),
    )
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert len(response.json()) == 2


def test_list_matches_omits_another_coachs_matches(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A match reaches its owner only through its player, so the scope is a join —
    and the other coach's match must be absent from the unfiltered list."""
    mine = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    # No player_id, so the factory mints the other coach and their player itself.
    make_match(db_session)
    db_session.commit()

    response = client.get("/matches")

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(mine.id)]


def test_list_matches_filtered_by_player(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The other match belongs to the caller too and is the newer one, so a filter
    that was ignored fails this on order as well as on length."""
    player = make_player(db_session, coach_id=coach.id)
    theirs = make_match(db_session, player_id=player.id, played_on=date(2026, 8, 1))
    make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        played_on=date(2026, 8, 2),
    )
    db_session.commit()

    response = client.get("/matches", params={"player_id": str(player.id)})

    assert response.status_code == 200
    assert [m["id"] for m in response.json()] == [str(theirs.id)]


@pytest.mark.usefixtures("coach")
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


@pytest.mark.usefixtures("coach")
def test_list_matches_filtered_by_another_coachs_player_is_empty(
    client: TestClient, db_session: Session
) -> None:
    """The player_id filter narrows the caller's scope, never widens it — and an
    empty list rather than an error keeps the filter from confirming the player
    exists, same as the by-id 404s."""
    other_player = make_player(db_session)
    make_match(db_session, player_id=other_player.id)
    db_session.commit()

    response = client.get("/matches", params={"player_id": str(other_player.id)})

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.usefixtures("coach")
def test_list_matches_rejects_a_malformed_player_id(client: TestClient) -> None:
    response = client.get("/matches", params={"player_id": "not-a-uuid"})

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
def test_list_matches_with_none_stored_is_an_empty_list(client: TestClient) -> None:
    response = client.get("/matches")

    assert response.status_code == 200
    assert response.json() == []


def test_get_match_returns_one(client: TestClient, db_session: Session, coach: Coach) -> None:
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
    )
    db_session.commit()

    response = client.get(f"/matches/{match.id}")

    assert response.status_code == 200
    assert response.json()["opponent_name"] == "Aryna"


def test_get_match_of_another_coach_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """404 and not 403, the recorded call: a 403 confirms the id exists, which hands
    an enumerator exactly what unguessable UUIDs exist to withhold."""
    other_match = make_match(db_session)
    db_session.commit()

    response = client.get(f"/matches/{other_match.id}")

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_get_match_unknown_id_is_404(client: TestClient) -> None:
    response = client.get(f"/matches/{uuid.uuid4()}")

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_get_match_malformed_id_is_422(client: TestClient) -> None:
    """A non-UUID path segment fails path validation rather than reaching the
    handler, so it is a 422 and not the 404 an unknown id gets."""
    response = client.get("/matches/not-a-uuid")

    assert response.status_code == 422


def test_update_match_changes_only_the_fields_sent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The point of exclude_unset: the fields absent from the body survive a PATCH that
    corrects the surface."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
        surface=Surface.HARD,
        event="Roland-Garros",
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"surface": "clay"})

    assert response.status_code == 200
    body = response.json()
    assert body["surface"] == "clay"
    assert body["opponent_name"] == "Aryna"
    assert body["event"] == "Roland-Garros"

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.surface is Surface.CLAY


def test_update_match_clears_a_nullable_field_with_an_explicit_null(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Null is how a client empties a field, which is the whole reason absent and null
    have to stay distinguishable."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
        event="Roland-Garros",
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"opponent_name": None})

    assert response.status_code == 200
    assert response.json()["opponent_name"] is None
    assert response.json()["event"] == "Roland-Garros"

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.opponent_name is None


def test_update_match_rejects_a_null_played_on(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The column is NOT NULL, and UNSET is what turns null into this 422 rather than an
    IntegrityError on the flush."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"played_on": None})

    assert response.status_code == 422


def test_update_match_with_an_empty_body_changes_nothing(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A PATCH with nothing set is a 200 no-op rather than an error: with every field
    optional there is no body that could be too empty to be valid."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={})

    assert response.status_code == 200
    assert response.json()["opponent_name"] == "Aryna"
    assert response.json()["played_on"] == "2026-08-01"


def test_update_match_bumps_updated_at(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Nothing in the route touches updated_at, so this pins that the column's onupdate
    is what moves it."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    before = match.updated_at

    response = client.patch(f"/matches/{match.id}", json={"event": "Roland-Garros"})

    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["updated_at"]) > before


def test_update_match_cannot_move_the_match_to_another_player(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """player_id is immutable by being absent from MatchUpdate, so pydantic drops it
    rather than 422ing. The other player is the caller's own, so what this pins is that
    the field cannot be written at all, not merely that its owner is checked."""
    player = make_player(db_session, coach_id=coach.id)
    other_player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    db_session.commit()

    response = client.patch(
        f"/matches/{match.id}", json={"player_id": str(other_player.id), "event": "Wimbledon"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["player_id"] == str(player.id)
    assert body["event"] == "Wimbledon"


def test_update_match_rejects_a_future_played_on(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The create bounds are shared with the update, so an edit cannot land a date the
    create route would have refused."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    tomorrow = date.today() + timedelta(days=1)

    response = client.patch(f"/matches/{match.id}", json={"played_on": tomorrow.isoformat()})

    assert response.status_code == 422


def test_update_match_of_another_coach_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """404 and not 403, as on the fetch — and the row has to come through untouched."""
    other_match = make_match(db_session, opponent_name="Aryna")
    db_session.commit()

    response = client.patch(f"/matches/{other_match.id}", json={"opponent_name": "Iga"})

    assert response.status_code == 404

    saved = db_session.get(Match, other_match.id)
    assert saved is not None
    assert saved.opponent_name == "Aryna"


@pytest.mark.usefixtures("coach")
def test_update_match_unknown_id_is_404(client: TestClient) -> None:
    response = client.patch(f"/matches/{uuid.uuid4()}", json={"event": "Wimbledon"})

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/matches"),
        ("get", "/matches"),
        ("get", f"/matches/{uuid.UUID(int=0)}"),
        ("patch", f"/matches/{uuid.UUID(int=0)}"),
    ],
)
def test_match_routes_require_a_session(client: TestClient, method: str, path: str) -> None:
    """No cookie, no history: every match route answers 401 before anything else —
    including validation, which is why the writes can send an empty body."""
    response = client.request(method, path, json={} if method in {"post", "patch"} else None)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
