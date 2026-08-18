import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from matchpoint_api.models import Coach, Match, MatchResult, Surface
from matchpoint_api.routers.matches import CAPTURE_CLAIM_TTL
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


def test_update_match_on_a_completed_match_is_409(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """A recorded result locks the match: the coach's remedy for a wrong one is to
    delete the match and record it again, which is why the row has to come through
    the refusal untouched."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        opponent_name="Aryna",
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"opponent_name": "Iga"})

    assert response.status_code == 409

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.opponent_name == "Aryna"


def test_update_match_cannot_change_a_recorded_result(
    client: TestClient, db_session: Session, coach: Coach
) -> None:
    """The result is the field that completes the match, so it is locked by the same
    rule as the rest and not exempt from it."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    response = client.patch(f"/matches/{match.id}", json={"result": "loss"})

    assert response.status_code == 409

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.result is MatchResult.WIN


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
    """The one thing the completed lock leaves open, and the reason the lock can be as
    strict as it is: a match recorded wrongly is cleared away and entered again."""
    match = make_match(
        db_session,
        player_id=make_player(db_session, coach_id=coach.id).id,
        result=MatchResult.WIN,
    )
    db_session.commit()

    assert client.delete(f"/matches/{match.id}").status_code == 204
    assert db_session.scalar(select(func.count()).select_from(Match)) == 0


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


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("post", "/capture", {"device_id": str(uuid.UUID(int=1))}),
        ("post", "/capture/release", None),
        ("patch", "", {"result": "win"}),
    ],
)
def test_the_routes_that_write_the_claim_lock_the_match_row(
    client: TestClient,
    db_session: Session,
    coach: Coach,
    method: str,
    suffix: str,
    body: dict[str, str] | None,
) -> None:
    """Each of these reads the claim and then writes it, so the read has to be locked:
    two requests reading before either writes would both win. Pinned on the emitted SQL
    because the suite shares one session, which cannot produce two concurrent requests,
    so dropping the lock would otherwise leave every test here green."""
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

    response = getattr(client, method)(f"/matches/{match.id}{suffix}", json=body)

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
    ],
)
def test_match_routes_require_a_session(client: TestClient, method: str, path: str) -> None:
    """No cookie, no history: every match route answers 401 before anything else —
    including validation, which is why the writes can send an empty body."""
    response = client.request(method, path, json={} if method in {"post", "patch"} else None)

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
