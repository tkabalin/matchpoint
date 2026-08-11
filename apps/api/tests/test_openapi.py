"""The committed spec is a build input, so it is asserted like one."""

import json
from pathlib import Path

import pytest

from matchpoint_api.openapi import SPEC_PATH, main, spec_json


def test_the_committed_spec_matches_the_routes() -> None:
    """A stale openapi.json generates a client that lies about the API.

    Nothing else notices: the API tests exercise the routes directly, and the web
    app compiles happily against whatever the last regeneration produced.
    """
    assert SPEC_PATH.read_text(encoding="utf-8") == spec_json(), (
        "openapi.json is stale — run scripts/gen-api-client.sh and commit the result"
    )


def test_operation_ids_are_unique() -> None:
    """Two routes sharing a handler name collide into one client function.

    FastAPI only warns, and the generator then emits one of the two silently, so the
    losing endpoint is simply absent from the client.
    """
    operation_ids = [
        operation["operationId"]
        for path in json.loads(spec_json())["paths"].values()
        for operation in path.values()
    ]

    assert sorted(operation_ids) == sorted(set(operation_ids))


def test_main_writes_the_spec_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Redirected at a temporary file: the entry point's own target is the repo's."""
    target = tmp_path / "openapi.json"
    monkeypatch.setattr("matchpoint_api.openapi.SPEC_PATH", target)

    main()

    assert target.read_text(encoding="utf-8") == spec_json()
