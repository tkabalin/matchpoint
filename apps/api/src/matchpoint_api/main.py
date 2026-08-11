from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from matchpoint_api import __version__
from matchpoint_api.config import settings
from matchpoint_api.errors import validation_error_response
from matchpoint_api.routers import coaches, matches, players


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

    # Replaces FastAPI's own 422 handler for every route at once, which is the point: a
    # secret must not depend on the route that received it remembering to redact.
    @app.exception_handler(RequestValidationError)
    async def redact_validation_errors(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return validation_error_response(exc)

    app.include_router(coaches.router)
    app.include_router(players.router)
    app.include_router(matches.router)

    # A comment rather than a docstring: this route is in the spec, and a docstring
    # would put every word of it in the generated TypeScript client too.
    #
    # `commit` names the build answering, which is what lets CI tell a deploy that
    # served from one that only started. It is read per request rather than closed
    # over, so the value is the running container's, not the one imported at build.
    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "commit": settings.commit}

    return app


app = create_app()
