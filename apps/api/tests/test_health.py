import pytest
from fastapi.testclient import TestClient

from matchpoint_api.config import settings


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_dev_when_no_commit_is_set(client: TestClient) -> None:
    assert client.get("/health").json()["commit"] == "dev"


def test_health_reports_the_deployed_commit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Patching after the app is built is the point: production sets this in the
    # container's environment, and CI reads it back to confirm the deploy it just
    # triggered is the build now serving.
    monkeypatch.setattr(settings, "commit", "a1b2c3d4")

    assert client.get("/health").json()["commit"] == "a1b2c3d4"
