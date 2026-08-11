"""Write the OpenAPI spec to a file the TypeScript client generator reads.

`packages/api-client` is generated from `apps/api/openapi.json` rather than from a
running server, so regenerating the client needs neither Python nor Postgres — a
frontend dev with only Node installed can do it. The cost is a file that can fall
out of step with the routes, which `tests/test_openapi.py` is there to catch.

Run via `scripts/gen-api-client.sh`, or directly:

    uv run python -m matchpoint_api.openapi
"""

import json
from pathlib import Path

from matchpoint_api.main import create_app

SPEC_PATH = Path(__file__).parents[2] / "openapi.json"


def spec_json() -> str:
    """The spec as it belongs on disk: sorted, indented, newline-terminated.

    Sorted so that reordering `include_router` calls doesn't reshuffle the file, and
    indented so a route's effect on the spec is legible in review.
    """
    return json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    SPEC_PATH.write_text(spec_json(), encoding="utf-8")


if __name__ == "__main__":  # pragma: no cover  # exercised by scripts/gen-api-client.sh
    main()
