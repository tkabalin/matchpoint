import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from psycopg.errors import ForeignKeyViolation
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import (
    Coach,
    DeletedMatch,
    Match,
    MatchResult,
    MatchSet,
    MatchSide,
    Point,
    RallyBucket,
    ReturnOutcome,
    ScoringSystem,
    Surface,
)
from matchpoint_api.routers.matches import (
    CAPTURE_CLAIM_TTL,
    COMPLETED_MATCH_IS_LOCKED,
    DELETED_MATCH_TTL,
    MATCH_IS_BEING_CAPTURED,
    MATCH_WAS_DELETED,
    POINT_IN_ANOTHER_MATCH,
    POINT_SEQUENCE_TAKEN,
)
from tests.factories import (
    make_coach,
    make_deleted_match,
    make_match,
    make_match_set,
    make_player,
    make_point,
    point_payload,
    sign_in,
)


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
            "scoring_system": "short_sets",
            "result": "win",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["player_id"] == str(player.id)
    assert body["opponent_name"] == "Aryna"
    assert body["played_on"] == "2026-08-01"
    assert body["surface"] == "clay"
    assert body["event"] == "Roland-Garros"
    assert body["scoring_system"] == "short_sets"
    assert body["result"] == "win"

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
    assert body["scoring_system"] is None
    assert body["result"] is None


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


def test_create_match_for_a_transferred_player_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The 404 that must not become the 410: redeeming a transfer code takes a player and
    their matches onto another roster, so a match still queued on this coach's device
    names a player they no longer own. The coach did not ask to lose it, and the status
    is what tells the sync layer to show it rather than destroy it."""
    player = make_player(db_session, coach_id=coach.id)
    body = {"id": str(uuid.uuid4()), "player_id": str(player.id), "played_on": "2026-08-01"}
    player.coach_id = make_coach(db_session).id
    db_session.commit()

    response = client.post("/matches", json=body)

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


def test_create_match_rejects_an_invalid_scoring_system(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session, coach_id=coach.id).id),
            "played_on": "2026-08-01",
            "scoring_system": "best_of_3",
        },
    )

    assert response.status_code == 422


def test_create_match_rejects_an_invalid_result(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    response = client.post(
        "/matches",
        json={
            "player_id": str(make_player(db_session, coach_id=coach.id).id),
            "played_on": "2026-08-01",
            "result": "draw",
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


def test_create_match_stores_a_client_supplied_id(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Capture happens offline, so the match is given its identity before any server
    sees it and has to keep it once it syncs."""
    player = make_player(db_session, coach_id=coach.id)
    match_id = uuid.uuid4()

    response = client.post(
        "/matches",
        json={"id": str(match_id), "player_id": str(player.id), "played_on": "2026-08-01"},
    )

    assert response.status_code == 201
    assert response.json()["id"] == str(match_id)
    assert db_session.get(Match, match_id) is not None


def test_create_match_mints_a_fresh_id_each_time_none_is_sent(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    player = make_player(db_session, coach_id=coach.id)
    body = {"player_id": str(player.id), "played_on": "2026-08-01"}

    first = client.post("/matches", json=body)
    second = client.post("/matches", json=body)

    assert first.json()["id"] != second.json()["id"]
    assert db_session.scalar(select(func.count()).select_from(Match)) == 2


def test_create_match_repeated_with_the_same_id_returns_the_stored_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The retry after a flush that was interrupted between the server writing and the
    client hearing: it has to succeed on the row already there rather than duplicate
    it, and the stored match wins over a body that disagrees with it."""
    player = make_player(db_session, coach_id=coach.id)
    body = {
        "id": str(uuid.uuid4()),
        "player_id": str(player.id),
        "played_on": "2026-08-01",
        "opponent_name": "Aryna",
    }

    first = client.post("/matches", json=body)
    repeat = client.post("/matches", json=body | {"opponent_name": "Iga"})

    assert first.status_code == 201
    assert repeat.status_code == 201
    assert repeat.json() == first.json()
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1
    # Expired first, because both requests ran through this one session: its identity
    # map would answer with the first write even if the repeat had overwritten the row,
    # so only a re-read proves the SET left it alone. Same below.
    db_session.expire_all()
    stored = db_session.get(Match, uuid.UUID(first.json()["id"]))
    assert stored is not None
    assert stored.opponent_name == "Aryna"


def test_create_match_repeated_under_another_player_returns_the_stored_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The id is the identity, so a repeat that disagrees about the player still gets
    the row that id already names, on the same first-write-wins rule."""
    player = make_player(db_session, coach_id=coach.id)
    other_player = make_player(db_session, coach_id=coach.id)
    stored = make_match(db_session, player_id=player.id)
    db_session.commit()

    response = client.post(
        "/matches",
        json={
            "id": str(stored.id),
            "player_id": str(other_player.id),
            "played_on": "2026-08-01",
        },
    )

    assert response.status_code == 201
    assert response.json()["player_id"] == str(player.id)
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1
    db_session.expire_all()
    assert stored.player_id == player.id


def test_create_match_refuses_an_id_the_coach_deleted(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The resurrection a queued create would otherwise manage: the coach deletes the
    match from a second device, the first flushes the create it still holds, and the
    upsert puts the row straight back. Answered 410 and not 404, so the sync layer can
    destroy the queued row on the one status that says the coach asked for this."""
    player = make_player(db_session, coach_id=coach.id)
    body = {"id": str(uuid.uuid4()), "player_id": str(player.id), "played_on": "2026-08-01"}
    assert client.post("/matches", json=body).status_code == 201
    assert client.delete(f"/matches/{body['id']}").status_code == 204

    response = client.post("/matches", json=body)

    assert response.status_code == 410
    assert response.json()["detail"] == MATCH_WAS_DELETED
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


def test_create_match_allows_an_id_whose_delete_has_aged_out(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The refusal lasts as long as an outbox could plausibly hold the create and no
    longer: one arriving after that is not a row that was queued behind the delete, and
    the record is left to stop matching rather than swept up by anything."""
    player = make_player(db_session, coach_id=coach.id)
    aged = make_deleted_match(
        db_session, deleted_at=datetime.now(UTC) - DELETED_MATCH_TTL - timedelta(minutes=1)
    )
    db_session.commit()

    response = client.post(
        "/matches",
        json={"id": str(aged.id), "player_id": str(player.id), "played_on": "2026-08-01"},
    )

    assert response.status_code == 201
    assert db_session.get(Match, aged.id) is not None


def test_create_match_with_another_coachs_match_id_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """An id belonging to someone else's match gets the 404 the match routes give any
    id the coach cannot reach, naming nothing about the row, and leaves it as it was."""
    theirs = make_match(db_session)
    player = make_player(db_session, coach_id=coach.id)
    db_session.commit()

    response = client.post(
        "/matches",
        json={"id": str(theirs.id), "player_id": str(player.id), "played_on": "2026-08-01"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Match not found"
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1
    db_session.expire_all()
    stored = db_session.get(Match, theirs.id)
    assert stored is not None
    assert stored.player_id != player.id


@pytest.mark.usefixtures("coach")
def test_create_match_rejects_a_malformed_id(client: TestClient) -> None:
    response = client.post(
        "/matches",
        json={"id": "not-a-uuid", "player_id": str(uuid.uuid4()), "played_on": "2026-08-01"},
    )

    assert response.status_code == 422


@pytest.mark.usefixtures("coach")
@pytest.mark.parametrize(
    "match_id",
    [uuid.UUID(int=0), uuid.uuid1(), uuid.uuid5(uuid.NAMESPACE_DNS, "matchpoint")],
    ids=["nil", "v1", "v5"],
)
def test_create_match_rejects_an_id_the_client_could_not_have_minted(
    client: TestClient, db_session: Session, match_id: uuid.UUID
) -> None:
    """Syntactically valid UUIDs of the wrong version: the client only ever mints
    version 4 (crypto.randomUUID), so these are caller bugs, not syncing matches."""
    response = client.post(
        "/matches",
        json={"id": str(match_id), "player_id": str(uuid.uuid4()), "played_on": "2026-08-01"},
    )

    assert response.status_code == 422
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


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
        result=MatchResult.LOSS,
    )
    db_session.commit()

    response = client.get(f"/matches/{match.id}")

    assert response.status_code == 200
    assert response.json()["opponent_name"] == "Aryna"
    assert response.json()["result"] == "loss"


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


def test_update_match_records_a_result(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The flow the field exists for: a match created before its outcome is known gets
    the result patched on afterwards."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"result": "win"})

    assert response.status_code == 200
    assert response.json()["result"] == "win"

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.result is MatchResult.WIN


def test_update_match_edits_the_metadata_of_a_completed_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The split lock (#228): the descriptive fields feed no computed statistic, so a
    typo'd opponent name stays correctable once the result is in, where the only way
    back before was deleting the match and the points captured against it."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
        surface=Surface.HARD,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(
        f"/matches/{match.id}",
        json={
            "opponent_name": "Iga",
            "surface": "clay",
            "event": "Wimbledon",
            "played_on": "2026-07-30",
        },
    )

    assert response.status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.opponent_name == "Iga"
    assert saved.surface is Surface.CLAY
    assert saved.event == "Wimbledon"
    assert saved.played_on == date(2026, 7, 30)
    assert saved.result is MatchResult.WIN


def test_update_match_with_an_empty_body_leaves_a_completed_match_alone(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A completed match now reaches the claim clearing on any edit, where before only
    the edit recording the result did. It clears two columns already null, which is no
    write at all, and updated_at standing still is what says so."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()
    before = match.updated_at

    response = client.patch(f"/matches/{match.id}", json={})

    assert response.status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.updated_at == before


def test_update_match_cannot_change_a_recorded_result(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The result is the field that completes the match, and flipping one after the
    fact rewrites every statistic the match is counted in, so it stays locked."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"result": "loss"})

    assert response.status_code == 409
    assert response.json() == {"detail": COMPLETED_MATCH_IS_LOCKED}

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.result is MatchResult.WIN


def test_update_match_cannot_change_a_completed_matchs_scoring_system(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The scoring system is locked beside the result: it is how the points already
    captured are read, so moving it retroactively changes what they say."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        scoring_system=ScoringSystem.TRADITIONAL,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"scoring_system": "pro_set"})

    assert response.status_code == 409

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.scoring_system is ScoringSystem.TRADITIONAL


def test_update_match_cannot_clear_a_completed_matchs_scoring_system(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Emptying a locked field is a change like any other, which is what keeps the
    "locked once set" reading from being one-way."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        scoring_system=ScoringSystem.TRADITIONAL,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"scoring_system": None})

    assert response.status_code == 409

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.scoring_system is ScoringSystem.TRADITIONAL


def test_update_match_fills_in_a_missing_scoring_system_after_completion(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Locked once set, and a null field was never set: a match recorded without a
    scoring system can still be told which one it was played under, the way the result
    itself was recorded after the fact."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"scoring_system": "pro_set"})

    assert response.status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.scoring_system is ScoringSystem.PRO_SET


def test_update_match_resending_the_stored_values_is_a_no_op(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The lock refuses edits, not repeats: capture queues its writes offline and
    retries them, so the second delivery of a finish that already landed has to read
    as success rather than park in the client's outbox."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(
        f"/matches/{match.id}", json={"result": "win", "opponent_name": "Aryna"}
    )

    assert response.status_code == 200
    assert response.json()["result"] == "win"


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
    """player_id is immutable by being absent from MatchUpdate, so RequestModel's
    extra="forbid" answers it with a 422. The other player is the caller's own, so what
    this pins is that the field cannot be written at all, not merely that its owner is
    checked."""
    player = make_player(db_session, coach_id=coach.id)
    other_player = make_player(db_session, coach_id=coach.id)
    match = make_match(db_session, player_id=player.id)
    db_session.commit()

    response = client.patch(
        f"/matches/{match.id}", json={"player_id": str(other_player.id), "event": "Wimbledon"}
    )

    assert response.status_code == 422
    assert match.player_id == player.id
    assert match.event is None


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
    """404 and not 403, as on the fetch, and the row has to come through untouched."""
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


def test_delete_match_removes_it(client: TestClient, db_session: Session, coach: Coach) -> None:
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = client.delete(f"/matches/{match.id}")

    assert response.status_code == 204
    assert client.get(f"/matches/{match.id}").status_code == 404
    assert client.get("/matches").json() == []
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


def test_delete_match_takes_its_derived_sets_with_it(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Through the route, where the model test cannot reach: the route names no child
    table of its own, so the cascade is the whole of what clears the set rows, and a
    foreign key that refused them instead would answer 500 on any captured match."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    make_match_set(db_session, match_id=match.id)
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204
    assert db_session.scalar(select(func.count()).select_from(MatchSet)) == 0


def test_delete_match_takes_its_points_with_it(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The reversal #214 asked for: a match captured against the wrong player or format
    used to be permanent once a single point had landed, and its points went on skewing
    every statistic they were counted in. The route erases them itself, `points.match_id`
    declaring no `ondelete`."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    make_point(db_session, match_id=match.id)
    make_point(db_session, match_id=match.id, sequence=1)
    db_session.commit()

    response = client.delete(f"/matches/{match.id}")

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0
    assert db_session.scalar(select(func.count()).select_from(Point)) == 0


def test_delete_match_leaves_another_matchs_points_alone(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The points are erased by match id, so the sibling match of the same player keeps
    its own: the delete is scoped to what the coach asked to lose."""
    player_id = make_player(db_session, coach_id=coach.id).id
    match = make_match(db_session, player_id=player_id)
    make_point(db_session, match_id=match.id)
    kept = make_point(db_session, match_id=make_match(db_session, player_id=player_id).id)
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204
    assert db_session.scalar(select(Point.id)) == kept.id


def test_delete_match_records_the_id_it_freed(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """What stops a create still queued on another device from putting the match back.
    Only the id is kept, and only the delete writes it, so nothing of the match itself
    survives the request."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204

    recorded = db_session.get(DeletedMatch, match.id)
    assert recorded is not None
    assert recorded.deleted_at > datetime.now(UTC) - timedelta(minutes=1)
    assert recorded.coach_id == coach.id


def test_deleting_a_reused_id_starts_its_window_over(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """An id the window has freed can be used again, so its second delete has to record
    the id afresh rather than collide with what the first delete left behind, and the
    new match's own queued create is refused for a full window from that second delete.
    The row also switches owner: a different coach deleted it the second time, so the
    first coach's account closure must not be the one that removes it."""
    player = make_player(db_session, coach_id=coach.id)
    aged = make_deleted_match(
        db_session, deleted_at=datetime.now(UTC) - DELETED_MATCH_TTL - timedelta(minutes=1)
    )
    original_coach_id = aged.coach_id
    db_session.commit()
    body = {"id": str(aged.id), "player_id": str(player.id), "played_on": "2026-08-01"}

    assert client.post("/matches", json=body).status_code == 201
    assert client.delete(f"/matches/{aged.id}").status_code == 204

    assert client.post("/matches", json=body).status_code == 410
    recorded = db_session.get(DeletedMatch, aged.id)
    assert recorded is not None
    assert recorded.coach_id == coach.id
    assert recorded.coach_id != original_coach_id


def test_delete_match_twice_is_404(client: TestClient, db_session: Session, coach: Coach) -> None:
    """Not idempotent the way logout's 204 is: the second call asks to delete a match
    that is not there, which is the unknown-id 404."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204
    assert client.delete(f"/matches/{match.id}").status_code == 404


def test_delete_match_of_another_coach_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The 404 the get route gives, and the row outlives it: a delete answered across
    the ownership boundary destroys someone else's history rather than just reading
    it."""
    other_match = make_match(db_session)
    db_session.commit()

    response = client.delete(f"/matches/{other_match.id}")

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1


@pytest.mark.usefixtures("coach")
def test_delete_match_unknown_id_is_404(client: TestClient) -> None:
    response = client.delete(f"/matches/{uuid.uuid4()}")

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_delete_match_malformed_id_is_422(client: TestClient) -> None:
    response = client.delete("/matches/not-a-uuid")

    assert response.status_code == 422


def test_delete_match_is_allowed_on_a_completed_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Completion locks two fields rather than the match, and delete is what is left
    for the one it still refuses to correct in place: a wrongly recorded result."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


# `_claimed_match` is defined just below, with the capture routes it was written for.
@pytest.mark.parametrize("names_a_device", [False, True])
def test_delete_match_under_another_devices_claim_is_refused(
    client: TestClient, db_session: Session, coach: Coach, names_a_device: bool
) -> None:
    """Deleting a match mid-capture leaves the capturing device recording into one that
    no longer exists, and every point it has queued with nothing to land in. Naming a
    device that is not the holder is the same refusal as naming none, which is what a
    client too old to send one does."""
    match = _claimed_match(db_session, coach, uuid.uuid4())
    db_session.commit()
    params = {"device_id": str(uuid.uuid4())} if names_a_device else None

    response = client.delete(f"/matches/{match.id}", params=params)

    assert response.status_code == 409
    assert response.json() == {"detail": MATCH_IS_BEING_CAPTURED}
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1


def test_the_capturing_device_may_delete_its_own_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Backing out of capture does not release the claim, so the device holding one is
    the likeliest to be deleting: a match set up wrongly, cleared away by the phone that
    just took it. Refusing there would wait out four hours to protect nobody."""
    device_id = uuid.uuid4()
    match = _claimed_match(db_session, coach, device_id)
    db_session.commit()

    response = client.delete(f"/matches/{match.id}", params={"device_id": str(device_id)})

    assert response.status_code == 204
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


def test_a_lapsed_claim_does_not_block_the_delete(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A lapsed claim counts as free everywhere else and has to here too: a device that
    stops talking to the server never releases, so one it left behind would keep the
    match undeletable rather than merely uncapturable."""
    match = _claimed_match(
        db_session,
        coach,
        uuid.uuid4(),
        capture_claim_expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


def test_releasing_the_claim_clears_the_way_for_the_delete(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The way through for a device that is not the holder, and the reason the refusal
    is not a dead end: release names no device, so any of the coach's can free a match
    the capturing one is not coming back to."""
    match = _claimed_match(db_session, coach, uuid.uuid4())
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 409
    assert client.post(f"/matches/{match.id}/capture/release").status_code == 204
    assert client.delete(f"/matches/{match.id}").status_code == 204


def test_the_capture_refusal_still_stands_over_a_match_with_points(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Points no longer refuse the delete, and the claim is now the only thing that does,
    so a claimed match keeps both its row and its points: the coach is told the match is
    being recorded right now, and a release is the way through."""
    match = _claimed_match(db_session, coach, uuid.uuid4())
    make_point(db_session, match_id=match.id)
    db_session.commit()

    response = client.delete(f"/matches/{match.id}")

    assert response.status_code == 409
    assert response.json() == {"detail": MATCH_IS_BEING_CAPTURED}
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1
    assert db_session.scalar(select(func.count()).select_from(Point)) == 1


def _claimed_match(
    session: Session, coach: Coach, device_id: uuid.UUID, **overrides: object
) -> Match:
    """One of the coach's matches, being captured on `device_id`.

    The claim runs the full lifetime unless a test passes an expiry of its own, which
    is how the lapsed-claim cases are arranged without waiting four hours for one.
    """
    return make_match(
        session,
        player_id=make_player(session, coach_id=coach.id).id,
        **{
            "capture_claim_device_id": device_id,
            "capture_claim_expires_at": datetime.now(UTC) + CAPTURE_CLAIM_TTL,
        }
        | overrides,
    )


def test_claim_capture_takes_a_free_match(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    device_id = uuid.uuid4()
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = client.post(f"/matches/{match.id}/capture", json={"device_id": str(device_id)})

    assert response.status_code == 200
    body = response.json()
    assert body["device_id"] == str(device_id)
    # The whole lifetime and not merely a deadline in the future: the lapse design
    # rests on the figure, and a route granting one of its own would pass anything
    # weaker while leaving a claim to expire mid-match.
    granted = datetime.fromisoformat(body["expires_at"])
    assert CAPTURE_CLAIM_TTL - timedelta(minutes=1) < granted - datetime.now(UTC)
    assert granted - datetime.now(UTC) <= CAPTURE_CLAIM_TTL

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == device_id
    assert saved.capture_claim_expires_at == granted


def test_claim_capture_renews_the_claim_of_the_device_holding_it(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Claiming again is how a device keeps the match: without the renewal, a capture
    running longer than the lifetime would lose the match part-way through it."""
    device_id = uuid.uuid4()
    match = _claimed_match(
        db_session,
        coach,
        device_id,
        capture_claim_expires_at=datetime.now(UTC) + timedelta(minutes=1),
    )
    db_session.commit()
    before = match.capture_claim_expires_at
    assert before is not None

    response = client.post(f"/matches/{match.id}/capture", json={"device_id": str(device_id)})

    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["expires_at"]) > before


def test_claim_capture_refuses_a_second_device(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The whole point of the claim: the same coach on a second device would otherwise
    capture the same match twice over, and the two streams of points cannot be
    reconciled afterwards."""
    holder = uuid.uuid4()
    match = _claimed_match(db_session, coach, holder)
    db_session.commit()

    response = client.post(f"/matches/{match.id}/capture", json={"device_id": str(uuid.uuid4())})

    assert response.status_code == 409

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == holder


def test_claim_capture_takes_over_a_lapsed_claim(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A device that goes quiet never releases, so the deadline is what stops one
    flat battery locking a match out of capture for good."""
    device_id = uuid.uuid4()
    match = _claimed_match(
        db_session,
        coach,
        uuid.uuid4(),
        capture_claim_expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db_session.commit()

    response = client.post(f"/matches/{match.id}/capture", json={"device_id": str(device_id)})

    assert response.status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == device_id


def test_claim_capture_on_a_completed_match_is_409(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Capture is for a match in progress, and a recorded result is what ends one."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.post(f"/matches/{match.id}/capture", json={"device_id": str(uuid.uuid4())})

    assert response.status_code == 409

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id is None


def test_claim_capture_of_another_coachs_match_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The 404 every other match route gives across the boundary, and the claim it
    would have overwritten is left alone."""
    holder = uuid.uuid4()
    other_match = make_match(
        db_session,
        capture_claim_device_id=holder,
        capture_claim_expires_at=datetime.now(UTC) + CAPTURE_CLAIM_TTL,
    )
    db_session.commit()

    response = client.post(
        f"/matches/{other_match.id}/capture", json={"device_id": str(uuid.uuid4())}
    )

    assert response.status_code == 404

    saved = db_session.get(Match, other_match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == holder


@pytest.mark.usefixtures("coach")
def test_claim_capture_unknown_id_is_404(client: TestClient) -> None:
    response = client.post(
        f"/matches/{uuid.uuid4()}/capture", json={"device_id": str(uuid.uuid4())}
    )

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_claim_capture_requires_a_device_id(client: TestClient) -> None:
    """The claim is worth nothing without one: a claim naming nobody could not tell a
    renewal from a second device."""
    response = client.post(f"/matches/{uuid.uuid4()}/capture", json={})

    assert response.status_code == 422


def test_release_capture_frees_the_match_for_another_device(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Release names no device deliberately: it is how a coach whose phone died moves
    to the tablet without waiting the claim out."""
    match = _claimed_match(db_session, coach, uuid.uuid4())
    db_session.commit()

    assert client.post(f"/matches/{match.id}/capture/release").status_code == 204

    response = client.post(f"/matches/{match.id}/capture", json={"device_id": str(uuid.uuid4())})

    assert response.status_code == 200


def test_release_capture_on_an_unclaimed_match_is_a_no_op(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Retried like every other write the client queues, so releasing twice is a
    second 204 rather than an error."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    assert client.post(f"/matches/{match.id}/capture/release").status_code == 204
    assert client.post(f"/matches/{match.id}/capture/release").status_code == 204


def test_release_capture_of_another_coachs_match_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A release answered across the boundary would drop another coach's device out of
    a match it is part-way through capturing."""
    holder = uuid.uuid4()
    other_match = make_match(
        db_session,
        capture_claim_device_id=holder,
        capture_claim_expires_at=datetime.now(UTC) + CAPTURE_CLAIM_TTL,
    )
    db_session.commit()

    response = client.post(f"/matches/{other_match.id}/capture/release")

    assert response.status_code == 404

    saved = db_session.get(Match, other_match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == holder


def test_recording_the_result_releases_the_capture_claim(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Finishing the match ends capture, so the claim goes with it rather than
    standing for hours over a match nothing can capture."""
    match = _claimed_match(db_session, coach, uuid.uuid4())
    db_session.commit()

    assert client.patch(f"/matches/{match.id}", json={"result": "win"}).status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id is None
    assert saved.capture_claim_expires_at is None


def _ingest(
    client: TestClient,
    match: Match,
    points: list[dict[str, Any]],
    device_id: uuid.UUID | None = None,
) -> httpx2.Response:
    body = {"device_id": str(device_id or uuid.uuid4()), "points": points}
    return client.post(f"/matches/{match.id}/points", json=body)


def _points_of(session: Session) -> list[int]:
    return list(session.scalars(select(Point.sequence).order_by(Point.sequence)))


def _without_updated_at(sets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in row.items() if key != "updated_at"} for row in sets]


def test_ingest_points_stores_the_batch_and_answers_with_the_derived_sets(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """One flush, two sets: the points land as sent and the set rows are counted off
    them, since nothing else in the request says what the score is."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = _ingest(
        client,
        match,
        [
            point_payload(sequence=0, won=True, is_game_end=True),
            point_payload(sequence=1, won=False, is_game_end=True, is_set_end=True),
            point_payload(sequence=2, won=True, set_number=2, is_game_end=True),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["set_number"] for row in body] == [1, 2]
    assert body[0]["match_id"] == str(match.id)
    assert body[0]["games_won_tracked"] == 1
    assert body[0]["games_won_opponent"] == 1
    assert body[0]["winner"] == "opponent"
    assert body[1]["games_won_tracked"] == 1
    assert body[1]["winner"] is None
    assert _points_of(db_session) == [0, 1, 2]


def test_ingest_stores_every_field_the_client_stamped(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The columns the batch reaches are the ones the schema names, so a field wired to
    the wrong one is only visible on the row."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    payload = point_payload(
        sequence=4,
        server="opponent",
        serve1_box=None,
        return_outcome="in",
        note="Second serve too short again.",
        rally_length_bucket="b3",
        set_number=2,
        game_number=7,
        in_tiebreak=True,
        is_break_point=True,
    )

    assert _ingest(client, match, [payload]).status_code == 200

    saved = db_session.get(Point, uuid.UUID(payload["id"]))
    assert saved is not None
    assert saved.match_id == match.id
    assert saved.server is MatchSide.OPPONENT
    assert saved.return_outcome is ReturnOutcome.IN
    assert saved.note == "Second serve too short again."
    assert saved.rally_length_bucket is RallyBucket.B3
    assert saved.set_number == 2
    assert saved.game_number == 7
    assert saved.in_tiebreak is True
    assert saved.is_break_point is True


def test_ingesting_the_same_batch_again_lands_on_the_same_answer(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """What makes a retry after a dropped connection safe: the flush that may already
    have been applied answers the same way rather than failing on its own writes.

    `updated_at` is the exception, and reads as when the tally was last recomputed
    rather than when it last changed: the recompute rewrites the row unconditionally,
    and comparing the old tally to skip a write would cost a read to save nothing.
    """
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    points = [point_payload(sequence=index, is_game_end=True) for index in range(3)]

    first = _ingest(client, match, points)
    second = _ingest(client, match, points)

    assert second.status_code == 200
    assert _without_updated_at(second.json()) == _without_updated_at(first.json())
    assert second.json()[0]["updated_at"] > first.json()[0]["updated_at"]
    assert _points_of(db_session) == [0, 1, 2]


def test_a_repeated_point_keeps_the_stored_version(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A point is immutable once ingested, so a second body under the same id is the
    point we already hold, whatever it says."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    payload = point_payload(won=True)

    assert _ingest(client, match, [payload]).status_code == 200
    assert _ingest(client, match, [payload | {"won": False}]).status_code == 200

    saved = db_session.get(Point, uuid.UUID(payload["id"]))
    assert saved is not None
    assert saved.won is True


def test_an_overlapping_batch_converges(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A drain that re-sends from further back than it needed to: the overlap is
    ignored and the new points land, so the match ends up with the union."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    points = [point_payload(sequence=index, is_game_end=True) for index in range(4)]

    assert _ingest(client, match, points[:3]).status_code == 200
    response = _ingest(client, match, points[1:])

    assert response.status_code == 200
    assert response.json()[0]["games_won_tracked"] == 4
    assert _points_of(db_session) == [0, 1, 2, 3]


def test_ingest_recomputes_the_sets_a_late_batch_changes(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The recompute reads every point of the match, not just the batch, which is what
    lets a set row that was a score so far become a result."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    first = _ingest(client, match, [point_payload(sequence=0, is_game_end=True)]).json()
    assert first[0]["games_won_tracked"] == 1
    assert first[0]["winner"] is None

    second = _ingest(
        client, match, [point_payload(sequence=1, is_game_end=True, is_set_end=True)]
    ).json()

    assert second[0]["id"] == first[0]["id"]
    assert second[0]["games_won_tracked"] == 2
    assert second[0]["winner"] == "tracked"
    assert db_session.scalar(select(func.count()).select_from(MatchSet)) == 1


def test_ingest_into_a_completed_match_is_refused(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A recorded result locks the match (#108). Declared as a 409 because the sync
    layer has to tell a batch that will never be accepted from one to retry."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = _ingest(client, match, [point_payload()])

    assert response.status_code == 409
    assert response.json() == {"detail": "Match is completed"}
    assert db_session.scalar(select(func.count()).select_from(Point)) == 0


def test_a_sequence_already_held_by_a_different_point_is_refused(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Two devices capturing one match, which is what the claim exists to prevent and
    the unique constraint catches when it fails to. The batch is refused whole: there
    are no per-item results to report one bad point through, and the rest of it is not
    quietly kept."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    make_point(db_session, match_id=match.id, sequence=1)
    db_session.commit()

    response = _ingest(client, match, [point_payload(sequence=0), point_payload(sequence=1)])

    assert response.status_code == 409
    assert response.json() == {"detail": POINT_SEQUENCE_TAKEN}
    assert _points_of(db_session) == [1]


def test_a_point_already_stored_against_another_match_is_refused(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Insert-or-ignore on the id alone cannot tell "the point we already hold" from
    "a point of another match", and taking the second for the first would drop it and
    answer 200, which is the one thing this endpoint must never do with a point."""
    player_id = make_player(db_session, coach_id=coach.id).id
    match = make_match(db_session, player_id=player_id)
    elsewhere = make_point(db_session, match_id=make_match(db_session, player_id=player_id).id)
    db_session.commit()

    response = _ingest(
        client, match, [point_payload(id=str(elsewhere.id)), point_payload(sequence=1)]
    )

    assert response.status_code == 409
    assert response.json() == {"detail": POINT_IN_ANOTHER_MATCH}
    # The rest of the batch went with it, and the stored point stayed where it was.
    assert _points_of(db_session) == [elsewhere.sequence]
    assert elsewhere.match_id != match.id


def test_one_invalid_point_rejects_the_whole_batch(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Validation runs over the body before any of it reaches a row, so a batch with
    one bad point inserts none of the good ones."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = _ingest(
        client,
        match,
        [point_payload(sequence=0), point_payload(sequence=1, serve1_box=None)],
    )

    assert response.status_code == 422
    assert db_session.scalar(select(func.count()).select_from(Point)) == 0


def test_an_empty_batch_is_refused(client: TestClient, db_session: Session, coach: Coach) -> None:
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    assert _ingest(client, match, []).status_code == 422


def test_a_flush_from_the_claim_holder_renews_the_claim(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Flushing is evidence the device is still capturing, so it renews the claim the
    way claiming again does, which is the only renewal a device that has been offline
    can reach."""
    device_id = uuid.uuid4()
    stale = datetime.now(UTC) + timedelta(minutes=5)
    match = _claimed_match(db_session, coach, device_id, capture_claim_expires_at=stale)
    db_session.commit()

    assert _ingest(client, match, [point_payload()], device_id).status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == device_id
    assert saved.capture_claim_expires_at is not None
    assert saved.capture_claim_expires_at > stale


def test_a_flush_from_another_device_is_still_ingested(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The claim is not a gate on ingestion. A device capturing offline cannot renew,
    so by flush time its claim may have lapsed and another device taken the match on;
    refusing then would strand points that were genuinely played."""
    holder = uuid.uuid4()
    expires_at = datetime.now(UTC) + timedelta(minutes=5)
    match = _claimed_match(db_session, coach, holder, capture_claim_expires_at=expires_at)
    db_session.commit()

    assert _ingest(client, match, [point_payload()], uuid.uuid4()).status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id == holder
    assert saved.capture_claim_expires_at == expires_at
    assert _points_of(db_session) == [0]


def test_a_flush_does_not_claim_a_match_nobody_holds(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Renewing a claim and taking one are different things: claiming is the capture
    route's job, and a backlog flushed hours later must not seize a free match."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    assert _ingest(client, match, [point_payload()]).status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_device_id is None
    assert saved.capture_claim_expires_at is None


def test_a_flush_does_not_revive_the_lapsed_claim_it_once_held(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A lapsed claim counts as free, so the device that let it lapse renews nothing:
    another device may have taken the match on since."""
    device_id = uuid.uuid4()
    lapsed = datetime.now(UTC) - timedelta(minutes=1)
    match = _claimed_match(db_session, coach, device_id, capture_claim_expires_at=lapsed)
    db_session.commit()

    assert _ingest(client, match, [point_payload()], device_id).status_code == 200

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.capture_claim_expires_at == lapsed


def test_ingest_into_another_coachs_match_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The ownership 404 the other match routes give, and no point of theirs is
    written: a match reachable across the boundary would be one a stranger can add
    history to."""
    other_match = make_match(db_session)
    db_session.commit()

    response = _ingest(client, other_match, [point_payload()])

    assert response.status_code == 404
    assert db_session.scalar(select(func.count()).select_from(Point)) == 0


@pytest.mark.usefixtures("coach")
def test_ingest_into_an_unknown_match_is_404(client: TestClient) -> None:
    response = client.post(
        f"/matches/{uuid.uuid4()}/points",
        json={"device_id": str(uuid.uuid4()), "points": [point_payload()]},
    )

    assert response.status_code == 404


def test_ingest_into_a_deleted_match_is_410(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The batch a device kept capturing after the coach deleted the match from another
    one. It can never land, and the coach chose that, which the 404 an unknown id gets
    could not say: it is the status the sync layer discards the queued points on."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    match_id = match.id
    assert client.delete(f"/matches/{match_id}").status_code == 204

    response = client.post(
        f"/matches/{match_id}/points",
        json={"device_id": str(uuid.uuid4()), "points": [point_payload()]},
    )

    assert response.status_code == 410
    assert response.json()["detail"] == MATCH_WAS_DELETED
    assert db_session.scalar(select(func.count()).select_from(Point)) == 0


@pytest.mark.usefixtures("coach")
def test_ingest_into_a_match_whose_delete_has_aged_out_is_404(
    client: TestClient, db_session: Session
) -> None:
    """Past the window the id is an ordinary unknown one again, so the batch falls back
    to the 404 the route gives anything it cannot reach, and the sync layer shows it."""
    aged = make_deleted_match(
        db_session, deleted_at=datetime.now(UTC) - DELETED_MATCH_TTL - timedelta(minutes=1)
    )
    db_session.commit()

    response = client.post(
        f"/matches/{aged.id}/points",
        json={"device_id": str(uuid.uuid4()), "points": [point_payload()]},
    )

    assert response.status_code == 404


def test_list_points_orders_by_sequence_regardless_of_insertion_order(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Arrival order says nothing about a point's place in the match: a batch can be
    retried or flushed long after capture, so the list comes back by the
    client-assigned sequence, not by insertion order."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    make_point(db_session, match_id=match.id, sequence=2)
    make_point(db_session, match_id=match.id, sequence=0)
    make_point(db_session, match_id=match.id, sequence=1)
    db_session.commit()

    response = client.get(f"/matches/{match.id}/points")

    assert response.status_code == 200
    assert [row["sequence"] for row in response.json()] == [0, 1, 2]


def test_list_points_of_a_match_with_none_recorded_is_an_empty_list(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()

    response = client.get(f"/matches/{match.id}/points")

    assert response.status_code == 200
    assert response.json() == []


def test_list_points_of_another_coachs_match_is_404(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The ownership 404 the other match routes give, not a 403 that would confirm the
    id exists."""
    other_match = make_match(db_session)
    make_point(db_session, match_id=other_match.id)
    db_session.commit()

    response = client.get(f"/matches/{other_match.id}/points")

    assert response.status_code == 404


@pytest.mark.usefixtures("coach")
def test_list_points_of_an_unknown_match_is_404(client: TestClient) -> None:
    response = client.get(f"/matches/{uuid.uuid4()}/points")

    assert response.status_code == 404


def test_list_points_round_trips_every_field_the_ingest_route_stored(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The read contract matches the write contract: what a flush stored comes back
    field for field, which is what pins a mapping fixed on one side and not the other."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
    payload = point_payload(
        sequence=7,
        server="tracked",
        won=True,
        serve1_outcome="fault",
        serve1_box=None,
        serve1_fault_mode="net",
        serve2_outcome="in",
        serve2_box="ad",
        serve2_fault_mode=None,
        return_outcome=None,
        end_reason="mistake",
        unusual_reason=None,
        note="Deep backhand volley error.",
        wing="backhand",
        shot_type="volley",
        ball_in=False,
        ball_half=None,
        ball_depth=None,
        ball_out_mode="long",
        rally_length_bucket="b2",
        set_number=3,
        game_number=5,
        in_tiebreak=True,
        is_break_point=True,
        is_game_point=True,
        is_game_end=True,
        is_set_point=True,
        is_set_end=True,
        is_match_point=True,
    )
    assert _ingest(client, match, [payload]).status_code == 200

    response = client.get(f"/matches/{match.id}/points")

    assert response.status_code == 200
    [point] = response.json()
    assert point == payload | {"match_id": str(match.id)}


def test_list_points_carries_no_ingestion_timestamps(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """created_at and updated_at are ingestion bookkeeping on a row that is never
    corrected once synced, which is why PointRead leaves them off."""
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    make_point(db_session, match_id=match.id)
    db_session.commit()

    response = client.get(f"/matches/{match.id}/points")

    [point] = response.json()
    assert "created_at" not in point
    assert "updated_at" not in point


def test_an_integrity_error_that_is_not_a_conflict_is_not_absorbed(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """Only a unique violation becomes the 409 above; any other integrity failure is a
    bug and stays a server error, since answering "that sequence is taken" would send
    whoever hit it looking in the wrong place.

    Engineered, there being no body that reaches this arm: a `before_flush` hook rides
    in an unrelated row with a dangling foreign key just as the route's own write is
    about to run.
    """
    device_id = uuid.uuid4()
    match = _claimed_match(db_session, coach, device_id)
    db_session.commit()

    @event.listens_for(db_session, "before_flush")
    def _sabotage(session: Session, _context: object, _instances: object) -> None:
        if any(isinstance(dirty, Match) for dirty in session.dirty):
            session.add(Match(player_id=uuid.uuid4(), played_on=date(2026, 8, 1)))

    with pytest.raises(IntegrityError) as caught:
        _ingest(client, match, [point_payload()], device_id)

    assert isinstance(caught.value.orig, ForeignKeyViolation)


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("post", "/capture", {"device_id": str(uuid.UUID(int=1))}),
        ("post", "/capture/release", None),
        ("patch", "", {"result": "win"}),
        (
            "post",
            "/points",
            {"device_id": str(uuid.UUID(int=1)), "points": [point_payload()]},
        ),
        ("delete", "", None),
    ],
)
def test_the_routes_that_read_the_claim_lock_the_match_row(
    client: TestClient,
    db_session: Session,
    coach: Coach,
    method: str,
    suffix: str,
    body: dict[str, str] | None,
) -> None:
    """Each of these reads the claim and then writes the row, so the read has to be
    locked: two requests reading before either writes would both win. Pinned on the
    emitted SQL because the suite shares one session, which cannot produce two concurrent
    requests, so dropping the lock would otherwise leave every test here green.

    Driven through `request` rather than the named methods because httpx's `delete` takes
    no body, and the parametrize carries one for the routes that do.
    """
    match = make_match(db_session, player_id=make_player(db_session, coach_id=coach.id).id)
    db_session.commit()
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

    response = client.request(method.upper(), f"/matches/{match.id}{suffix}", json=body)

    assert response.status_code in {200, 204}
    assert any("FOR UPDATE OF matches" in statement for statement in statements)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/matches"),
        ("get", "/matches"),
        ("get", f"/matches/{uuid.UUID(int=0)}"),
        ("patch", f"/matches/{uuid.UUID(int=0)}"),
        ("delete", f"/matches/{uuid.UUID(int=0)}"),
        ("post", f"/matches/{uuid.UUID(int=0)}/capture"),
        ("post", f"/matches/{uuid.UUID(int=0)}/capture/release"),
        ("post", f"/matches/{uuid.UUID(int=0)}/points"),
        ("get", f"/matches/{uuid.UUID(int=0)}/points"),
    ],
)
def test_match_routes_require_a_session(client: TestClient, method: str, path: str) -> None:
    """No cookie, no history: every match route answers 401 before anything else —
    including validation, which is why the writes can send an empty body."""
    response = client.request(method, path, json={} if method in {"post", "patch"} else None)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
