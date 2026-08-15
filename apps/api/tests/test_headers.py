from fastapi.testclient import TestClient

from matchpoint_api.headers import DOCS_CSP, STRICT_CSP
from matchpoint_api.main import create_app

# The full set a JSON response must carry (docs/security.md). Asserted verbatim so a
# weakened value fails, not just a missing header.
STRICT_HEADERS = {
    "Content-Security-Policy": STRICT_CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


def test_json_responses_carry_the_strict_headers(client: TestClient) -> None:
    response = client.get("/health")

    for name, value in STRICT_HEADERS.items():
        assert response.headers[name] == value


def test_error_responses_carry_them_too(client: TestClient) -> None:
    # A 422 is built by an exception handler, not the route: the headers must ride
    # whatever response the request ends in, which is the reason this is middleware.
    response = client.post("/auth/login", json={})

    assert response.status_code == 422
    for name, value in STRICT_HEADERS.items():
        assert response.headers[name] == value


def test_a_refused_origin_gets_them_too(client: TestClient) -> None:
    # The origin check answers its 403 without calling through, so nothing inside it
    # runs. Only its place in main.py's middleware order puts the headers on this one.
    response = client.post("/auth/login", json={}, headers={"Origin": "https://elsewhere.test"})

    assert response.status_code == 403
    for name, value in STRICT_HEADERS.items():
        assert response.headers[name] == value


def test_docs_page_gets_its_scoped_csp(client: TestClient) -> None:
    response = client.get("/docs")

    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == DOCS_CSP
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_the_docs_csp_survives_the_deployed_root_path() -> None:
    # The client fixture leaves root_path empty, which no deployment does: uvicorn runs
    # with --root-path /api and prefixes it onto the path the middleware reads, so this
    # is the only shape in which the exemption is asked to fire where it matters.
    with TestClient(create_app(), root_path="/api") as root_path_client:
        response = root_path_client.get("/api/docs")

    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == DOCS_CSP


def test_docs_relaxation_does_not_reach_the_spec_route(client: TestClient) -> None:
    assert client.get("/openapi.json").headers["Content-Security-Policy"] == STRICT_CSP


def test_the_html_pages_nobody_uses_are_gone(client: TestClient) -> None:
    assert client.get("/redoc").status_code == 404
    assert client.get("/docs/oauth2-redirect").status_code == 404
