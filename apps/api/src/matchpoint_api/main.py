from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from matchpoint_api import __version__
from matchpoint_api.auth import SessionRenewalMiddleware
from matchpoint_api.config import settings
from matchpoint_api.csrf import OriginCheckMiddleware
from matchpoint_api.errors import validation_error_response
from matchpoint_api.mail import create_email_sender
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

    # Added last and therefore outermost, since add_middleware inserts at the front of
    # the stack: a write from a foreign origin is refused before anything reads the
    # session it carried or spends a rate-limit token on it.
    app.add_middleware(OriginCheckMiddleware)

    # Sign-up: sized for security.py's two Argon2 slots (see routers/coaches.py).
    app.state.sign_up_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.sign_up_total_limit = RateLimiter(per_minute=30, burst=10)

    # Login: per-account is a wrong-guess budget, not an arrival counter — a correct
    # password is never refused (see routers/auth.py). Wider than sign-up because
    # these are existing coaches, not strangers.
    app.state.login_per_account_limit = RateLimiter(per_minute=2, burst=5)
    app.state.login_per_ip_limit = RateLimiter(per_minute=10, burst=20)
    app.state.login_total_limit = RateLimiter(per_minute=120, burst=20)

    # request-otp: the cost is outbound email, not CPU. Per-email charges on arrival
    # and refunds a failed send, so only mail that reached an inbox is paid for
    # (routers/auth.py); the price is that knowing an address can block its sign-up.
    # Sized under Resend's free tier, whose binding limit is 100 messages a day — the
    # deploy smoke check spends from the same budget, one message per deploy to main.
    app.state.request_otp_per_email_limit = RateLimiter(per_minute=0.2, burst=3)
    app.state.request_otp_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.request_otp_total_limit = RateLimiter(per_minute=30, burst=10)

    # verify-otp: arrival-rate only — the row's in-database attempt budget is the
    # real guessing bound (see routers/auth.py::limit_verify_otp_rate).
    app.state.verify_otp_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.verify_otp_total_limit = RateLimiter(per_minute=30, burst=10)

    # forgot-password and reset-password: request-otp's and verify-otp's tiers over
    # again — the same costs (outbound email, then code guesses) at the same sizes,
    # in buckets of their own so a sign-up flood cannot starve password recovery.
    app.state.forgot_password_per_email_limit = RateLimiter(per_minute=0.2, burst=3)
    app.state.forgot_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.forgot_password_total_limit = RateLimiter(per_minute=30, burst=10)
    app.state.reset_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.reset_password_total_limit = RateLimiter(per_minute=30, burst=10)

    # change-password: two Argon2 runs a call, a verification and then a hash, so
    # sign-up's arrival sizes rather than login's wider ones. Per-coach is login's
    # wrong-guess budget again, charged only after a failed verification, so a coach who
    # knows their own password is never refused (see routers/auth.py).
    app.state.change_password_per_coach_limit = RateLimiter(per_minute=2, burst=5)
    app.state.change_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.change_password_total_limit = RateLimiter(per_minute=30, burst=10)

    # Outbound email, on app state for the buckets' reason — every create_app() gets
    # a sender of its own, so no test can send real mail and any test can read what
    # was sent by swapping in a recorder. Which sender is settings' call (mail.py).
    app.state.email_sender = create_email_sender()

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
