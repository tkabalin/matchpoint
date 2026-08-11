from fastapi import FastAPI
from fastapi.routing import APIRoute

from matchpoint_api import __version__
from matchpoint_api.config import settings
from matchpoint_api.routers import matches, players


def operation_id(route: APIRoute) -> str:
    """Name a route in the OpenAPI spec after its handler, and nothing else.

    The generated TypeScript client takes its function names straight from these, and
    FastAPI's default folds the path and method in — `create_player_players_post`
    rather than `createPlayer`. Every call site in the web app reads better for this.

    The handler name has to stay unique across routers, which the spec test asserts.
    """
    return route.name


def create_app() -> FastAPI:
    app = FastAPI(
        title="MatchPoint API",
        version=__version__,
        debug=settings.debug,
        generate_unique_id_function=operation_id,
    )
    app.include_router(players.router)
    app.include_router(matches.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
