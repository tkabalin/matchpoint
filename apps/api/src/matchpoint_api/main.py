from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from matchpoint_api import __version__
from matchpoint_api.auth import SessionRenewalMiddleware
from matchpoint_api.config import settings
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

    # Login's bound — enforced by routers/auth.py, which says why there is a third tier
    # and why only the handler can spend it. Per-account is a budget of wrong guesses,
    # not of arrivals: five in the moment, then one every thirty seconds, and a correct
    # password is never refused by it, so knowing a coach's address buys an attacker
    # slower guessing rather than a way to keep that coach signed out.
    #
    # The other two tiers are sign-up's, sized against the same hardware but wider,
    # because they bound existing coaches signing in rather than strangers arriving. A
    # burst is what parks threads — a request waiting on security.py's two hashing slots
    # holds its worker — so it is anyio's forty-thread pool that caps it, not the CPU:
    # a full sign-up burst and a full login burst together park thirty of the forty,
    # leaving ten for everything else. That buys a room of testers behind one venue NAT
    # signing in at once, which ten did not.
    #
    # The shared rate is nearly free by comparison: 120 a minute is two arrivals a
    # second against roughly twelve a second of service, so no queue builds, and it is
    # a third of one core sustained. What it buys is the ratio — holding the shared
    # bucket at zero needs twelve addresses at the per-address rate instead of three.
    # It does not buy immunity: a flood that sustains 120 a minute still refuses every
    # coach. That is the cost of a bound no address escapes, and the alternative is the
    # parked threadpool rate_limit.py exists to prevent. The shared buckets stay split
    # from sign-up's so that a flood on one route cannot close the other.
    app.state.login_per_account_limit = RateLimiter(per_minute=2, burst=5)
    app.state.login_per_ip_limit = RateLimiter(per_minute=10, burst=20)
    app.state.login_total_limit = RateLimiter(per_minute=120, burst=20)

    # request-otp's bound — enforced at the top of its handler, which says why the
    # per-email tier exists. The cost being priced is different in kind from the
    # Argon2 arithmetic above: each 202 is an outbound email, so the tiers answer for
    # provider quota, a young sending domain's reputation, and strangers' inboxes
    # rather than for CPU. Per-email, three in the burst then one every five minutes,
    # is sized for a person who mistyped or whose mail was slow — and it is also the
    # guessing bound: with five attempts per code (auth.py's OTP_ATTEMPT_LIMIT), an
    # address's keyspace erodes at fifteen guesses up front and about one a minute
    # sustained, months of sustained work to cover half of it. The per-address and
    # shared tiers reuse sign-up's sizes because they meter the same strangers on the
    # same hardware; the shared bucket stays its own, as every route's does, so a
    # flood of code requests cannot close sign-up or login.
    #
    # Counting arrivals is what login's per-account tier was rewritten to stop doing,
    # and the objection carries here: anyone who knows an address can spend its burst
    # and hold it drained for one request every five minutes, and whoever owns that
    # address never receives a code. Login had somewhere to move the count to — a
    # failed verification, which a legitimate sign-in never produces. This endpoint has
    # nowhere: the request *is* the cost being priced, so there is no such thing as one
    # that turns out to have been free. Kept knowingly, as the milder of the two: the
    # alternative is an unmetered path to strangers' inboxes, and what is denied here
    # is a sign-up, not an account already in use.
    app.state.request_otp_per_email_limit = RateLimiter(per_minute=0.2, burst=3)
    app.state.request_otp_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.request_otp_total_limit = RateLimiter(per_minute=30, burst=10)

    # verify-otp's bound — a second layer only, and sized like sign-up's for the same
    # legitimate traffic, since the row's in-database attempt budget is what actually
    # caps guessing a code (routers/auth.py::limit_verify_otp_rate).
    app.state.verify_otp_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.verify_otp_total_limit = RateLimiter(per_minute=30, burst=10)

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
