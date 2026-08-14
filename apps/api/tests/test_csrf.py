"""The origin check on state-changing requests: the gap SameSite=Lax leaves open.

Exercised on an app of its own carrying one route per method, because the rule is about
the method and the header rather than any endpoint: going through a real route would drag
its schema and its database into a test of neither. That app is `create_app`'s, so what is
under test includes the middleware being registered at all.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from matchpoint_api.csrf import FOREIGN_ORIGIN, SAFE_METHODS
from matchpoint_api.main import create_app

# A host under an apex that serves other things, which is the deployment this check exists
# for: `blog` is a different origin to `app` and, to SameSite=Lax, the same site.
OWN_ORIGIN = "https://app.example.com"
SIBLING_ORIGIN = "https://blog.example.com"
FOREIGN = "https://not-matchpoint.example"

UNSAFE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


@pytest.fixture
def echo_client() -> Iterator[TestClient]:
    app = create_app()

    @app.api_route("/echo", methods=sorted(SAFE_METHODS | set(UNSAFE_METHODS)))
    def echo() -> dict[str, str]:
        return {"reached": "the route"}

    with TestClient(app, base_url=OWN_ORIGIN) as client:
        yield client


@pytest.mark.parametrize("method", UNSAFE_METHODS)
def test_a_write_from_our_own_origin_is_allowed(echo_client: TestClient, method: str) -> None:
    """The control, and the case that matters most: the SPA is served from the same origin
    as the API, so this is every write the app itself makes."""
    response = echo_client.request(method, "/echo", headers={"Origin": OWN_ORIGIN})

    assert response.status_code == 200


@pytest.mark.parametrize("method", UNSAFE_METHODS)
def test_a_write_from_another_origin_is_refused(echo_client: TestClient, method: str) -> None:
    """Every method that changes something, not only POST: a check that covered POST alone
    would be one PUT away from being no check."""
    response = echo_client.request(method, "/echo", headers={"Origin": FOREIGN})

    assert response.status_code == 403
    assert response.json()["detail"] == FOREIGN_ORIGIN


def test_a_write_from_a_sibling_host_of_our_own_apex_is_refused(echo_client: TestClient) -> None:
    """The residual this exists to close. SameSite=Lax counts every host under the shared
    registrable domain as same-site, so this request arrives with the session cookie
    attached and the cookie's own flags have nothing left to say about it."""
    response = echo_client.post("/echo", headers={"Origin": SIBLING_ORIGIN})

    assert response.status_code == 403
    assert response.json()["detail"] == FOREIGN_ORIGIN


def test_a_write_with_no_origin_at_all_is_refused(echo_client: TestClient) -> None:
    """The decision, pinned: absent is foreign. A browser sends the header on a write, so
    what an omission costs is non-browser callers (curl, the deploy smoke check), which
    send one deliberately rather than have the rule hold only when convenient."""
    response = echo_client.post("/echo")

    assert response.status_code == 403
    assert response.json()["detail"] == FOREIGN_ORIGIN


@pytest.mark.parametrize("origin", ["null", "app.example.com", "https://["])
def test_a_write_with_an_unusable_origin_is_refused(echo_client: TestClient, origin: str) -> None:
    """Anything that names no host to compare against is foreign, whatever the reason.
    `null` is what a sandboxed iframe sends, a bare host is not an origin, and the unclosed
    bracket makes the parse raise, which unhandled answers a hostile write 500 not 403."""
    response = echo_client.post("/echo", headers={"Origin": origin})

    assert response.status_code == 403
    assert response.json()["detail"] == FOREIGN_ORIGIN


@pytest.mark.parametrize("method", sorted(SAFE_METHODS))
def test_a_read_from_another_origin_is_allowed(echo_client: TestClient, method: str) -> None:
    """Nothing about a GET is worth refusing: it changes no state, and refusing one would
    break the ordinary cross-site link into the app that Lax deliberately permits."""
    response = echo_client.request(method, "/echo", headers={"Origin": FOREIGN})

    assert response.status_code == 200


def test_another_port_on_our_own_host_is_another_origin(echo_client: TestClient) -> None:
    """Ports are part of an origin but not of a cookie's scope, so a second app on
    localhost during development is exactly as foreign as another domain."""
    response = echo_client.post("/echo", headers={"Origin": "https://app.example.com:8443"})

    assert response.status_code == 403


def test_the_scheme_is_deliberately_not_compared(echo_client: TestClient) -> None:
    """Host and port decide it. The scheme the API sees is whatever X-Forwarded-Proto
    reported through Cloudflare and Caddy, and a proxy change that stopped reporting it
    would refuse every write in production to rule out an origin nobody can hold."""
    response = echo_client.post("/echo", headers={"Origin": "http://app.example.com"})

    assert response.status_code == 200
