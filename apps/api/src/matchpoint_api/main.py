from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from matchpoint_api import __version__
from matchpoint_api.auth import SessionRenewalMiddleware
from matchpoint_api.config import settings
from matchpoint_api.errors import validation_error_response
from matchpoint_api.rate_limit import RateLimiter
from matchpoint_api.routers import auth, coaches, matches, players


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

    # Outside the routers for the same reason as the handler above: a renewed session
    # cookie must reach the browser whichever response the request ends in, and a route
    # that raises never returns the object one could be written to.
    app.add_middleware(SessionRenewalMiddleware)

    # Sign-up's arrival-rate bound — enforced by routers/coaches.py::limit_sign_up_rate,
    # which says why there are two tiers and why they live on app state. Sized for the
    # hardware `security.py` documents: a full shared burst is ten hashes, under a second
    # of queue on two slots, so the threadpool never parks; sustained it is thirty hashes
    # a minute, a few percent of one slot. The per-address burst matches the shared one so
    # that a clubhouse of coaches signing up together behind one NAT is bounded by the
    # shared tier — the tier sized for the hardware — rather than refused sooner by a
    # tighter per-address one. Per-address fairness is then the sustained rate: a third of
    # the shared one, so a single address cannot hold sign-up for longer than its burst.
    app.state.sign_up_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.sign_up_total_limit = RateLimiter(per_minute=30, burst=10)

    app.include_router(auth.router)
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
