from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from matchpoint_api import __version__
from matchpoint_api.auth import SessionRenewalMiddleware, send_renewed_session
from matchpoint_api.body_limit import RequestBodyLimitMiddleware
from matchpoint_api.breach import create_breach_checker
from matchpoint_api.config import settings
from matchpoint_api.csrf import OriginCheckMiddleware
from matchpoint_api.errors import unhandled_exception_response, validation_error_response
from matchpoint_api.headers import SecurityHeadersMiddleware
from matchpoint_api.logs import RequestLogMiddleware, configure_logging
from matchpoint_api.mail import create_email_sender
from matchpoint_api.photos import MEDIA_PATH, mount_media
from matchpoint_api.rate_limit import RateLimiter
from matchpoint_api.routers import analytics, auth, coaches, matches, player_auth, players


def operation_id(route: APIRoute) -> str:
    """Name a route in the OpenAPI spec after its handler, and nothing else.

    The generated TypeScript client takes its function names straight from these, and
    FastAPI's default folds the path and method in — `create_player_players_post`
    rather than `createPlayer`. Every call site in the web app reads better for this.

    The handler name has to stay unique across routers, which the spec test asserts.
    """
    return route.name


def create_app() -> FastAPI:
    configure_logging()
    # Swagger at /docs stays up in production; it earns a relaxed CSP of its own in
    # headers.py. ReDoc and Swagger's OAuth2 redirect are off: HTML pages nobody uses,
    # and ReDoc's Google Fonts and blob: workers would roughly double that exemption.
    app = FastAPI(
        title="MatchPoint API",
        version=__version__,
        # Never set on a deployed box: Starlette checks debug *before* the handler below,
        # so turning it on to chase a fault replaces the generic 500 with an HTML page
        # carrying the traceback, its source lines and its frame locals.
        debug=settings.debug,
        generate_unique_id_function=operation_id,
        redoc_url=None,
        swagger_ui_oauth2_redirect_url=None,
    )

    # Replaces FastAPI's own 422 handler for every route at once, which is the point: a
    # secret must not depend on the route that received it remembering to redact.
    @app.exception_handler(RequestValidationError)
    async def redact_validation_errors(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return validation_error_response(exc)

    # Everything else, so that no failure answers with Starlette's plain-text default: a
    # body with no `detail` is one the generated client cannot read, which leaves the web
    # app showing a form's fallback text for a fault that has nothing to do with the form.
    # Starlette runs this above the middleware stack, which is what lets it catch a
    # middleware's own exception, and what makes this the one response the middleware
    # never decorates. So the renewed session cookie is sent here, and errors.py stamps
    # the headers: a renewal is already committed by the time a route raises.
    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        response = await unhandled_exception_response(request, exc)
        send_renewed_session(request, response)
        return response

    # Added first, so innermost: a mid-stream refusal is an HTTPException raised from
    # `receive`, and it only reaches FastAPI's handler with no BaseHTTPMiddleware in
    # between. Crossing one, it surfaces as a 400 "error parsing the body" instead.
    app.add_middleware(RequestBodyLimitMiddleware)

    # Outside the routers for the same reason as the handler above: a renewed session
    # cookie must reach the browser whichever response the request ends in, and a route
    # that raises never returns the object one could be written to.
    app.add_middleware(SessionRenewalMiddleware)

    # Ahead of the session and rate-limit work, since add_middleware inserts at the front
    # of the stack: a write from a foreign origin is refused before anything reads the
    # session it carried or spends a rate-limit token on it.
    app.add_middleware(OriginCheckMiddleware)

    # Outside the origin check: it answers its own 403 without calling through, so
    # headers added inside it would miss that response.
    app.add_middleware(SecurityHeadersMiddleware)

    # Added last, so it wraps everything above: the request id must exist before any
    # other code can log, and the logged status is the one the wire actually saw. The
    # 403 above is the clearest case, being a response no route ever sees.
    app.add_middleware(RequestLogMiddleware)

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

    # The reset flow: sign-up's three endpoints over again, stage for stage, at the
    # same sizes and in buckets of their own so a sign-up flood cannot starve password
    # recovery. forgot-password's cost is outbound email (request-otp's), then
    # verify-reset-code's is code guesses (verify-otp's), then reset-password's is the
    # one Argon2 hash behind the cookie (POST /coaches').
    app.state.forgot_password_per_email_limit = RateLimiter(per_minute=0.2, burst=3)
    app.state.forgot_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.forgot_password_total_limit = RateLimiter(per_minute=30, burst=10)
    app.state.verify_reset_code_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.verify_reset_code_total_limit = RateLimiter(per_minute=30, burst=10)
    app.state.reset_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.reset_password_total_limit = RateLimiter(per_minute=30, burst=10)

    # change-password: two Argon2 runs a call, a verification and then a hash, so
    # sign-up's arrival sizes rather than login's wider ones. Per-coach is login's
    # wrong-guess budget again, charged only after a failed verification, so a coach who
    # knows their own password is never refused (see routers/auth.py).
    app.state.change_password_per_coach_limit = RateLimiter(per_minute=2, burst=5)
    app.state.change_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.change_password_total_limit = RateLimiter(per_minute=30, burst=10)

    # Closing an account: change-password's tiers at change-password's sizes, in buckets
    # of their own so guessing at one route cannot stand between a coach and the other.
    # One Argon2 run a call rather than two, so the arrival sizes are if anything
    # conservative; the per-coach budget is the one that matters here, bounding a stolen
    # session's hunt for a password on the one route whose success is not undoable.
    app.state.close_account_per_coach_limit = RateLimiter(per_minute=2, burst=5)
    app.state.close_account_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.close_account_total_limit = RateLimiter(per_minute=30, burst=10)

    # Photo upload: a decode is real CPU and tens of megabytes of pixels, gated two at
    # a time like Argon2 (photos.py), so these are arrival rates rather than budgets.
    # Deliberately mean per coach — setting an avatar is something done once and then
    # rarely — which still never refuses a coach changing their mind, and keeps a stolen
    # session from spending the one core on decodes. The shared bucket is the hard
    # bound, since getting past the first tier costs an account per bucket.
    app.state.photo_upload_per_coach_limit = RateLimiter(per_minute=6, burst=10)
    app.state.photo_upload_per_ip_limit = RateLimiter(per_minute=20, burst=20)
    app.state.photo_upload_total_limit = RateLimiter(per_minute=60, burst=20)

    # Player login: login's three tiers at login's sizes, in buckets of their own so a
    # flood at one entry point cannot price the other principal out of signing in. The
    # per-account key is the submitted username, a wrong-guess budget charged only
    # after a failed verification (routers/player_auth.py).
    app.state.player_login_per_account_limit = RateLimiter(per_minute=2, burst=5)
    app.state.player_login_per_ip_limit = RateLimiter(per_minute=10, burst=20)
    app.state.player_login_total_limit = RateLimiter(per_minute=120, burst=20)

    # Minting a player password, at creation and regeneration alike: each call is one
    # Argon2 hash, so photo upload's shape (a per-coach arrival rate taken in the
    # handler, once the coach has resolved). Sized off a squad rather than off sign-up,
    # whose sizes these were: the caller here is a coach we can name and revoke, and a
    # roster entered in one sitting is what the brief asks to be quick. The wider tiers
    # are multiples of the per-coach one, so one honest roster cannot refuse a second
    # coach, and the total still holds Argon2 to about a sixth of the single vCPU.
    app.state.player_password_per_coach_limit = RateLimiter(per_minute=30, burst=60)
    app.state.player_password_per_ip_limit = RateLimiter(per_minute=60, burst=120)
    app.state.player_password_total_limit = RateLimiter(per_minute=60, burst=120)

    # Every authenticated route: one budget per coach, charged in auth.current_coach.
    # The burst clears an outbox flushing two three-set matches of individually-posted
    # points (~250 each); the sustained rate is far above human use. An estimate until
    # point ingestion exists to measure (#56).
    app.state.authenticated_per_coach_limit = RateLimiter(per_minute=120, burst=600)

    # The routes that take the account back, held out of the budget above so a stolen
    # session cannot starve them (auth.recovery_coach). The same sustained rate as that
    # budget deliberately: holding a bucket empty costs its refill rate, so a slower one
    # here would make the denial this carve-out prevents cheaper to mount than it was.
    app.state.recovery_per_coach_limit = RateLimiter(per_minute=120, burst=60)

    # The player principal's copies of the two per-principal budgets, at the coach's
    # sustained rate with a smaller ordinary burst: a player reads their own stats and
    # has no point outbox to flush, which was the whole argument for 600. The recovery
    # budget keeps change-password reachable however drained a thief leaves the other.
    app.state.authenticated_per_player_limit = RateLimiter(per_minute=120, burst=60)
    app.state.recovery_per_player_limit = RateLimiter(per_minute=120, burst=60)

    # Player change-password: the coach route's tiers at its sizes, in buckets of
    # their own so guessing at one principal's route cannot stand between the other
    # and theirs. Two Argon2 runs a call, hence sign-up's arrival sizes again.
    app.state.player_change_password_per_player_limit = RateLimiter(per_minute=2, burst=5)
    app.state.player_change_password_per_ip_limit = RateLimiter(per_minute=10, burst=10)
    app.state.player_change_password_total_limit = RateLimiter(per_minute=30, burst=10)

    # A cookie naming no session, charged after the lookup it cost (auth.py). The key is
    # a Cloudflare edge address many coaches share, and every device still presenting a
    # revoked cookie charges it, so this bounds abuse by orders of magnitude rather than
    # metering one caller: a tight figure here would refuse honest callers first.
    app.state.unknown_session_per_ip_limit = RateLimiter(per_minute=600, burst=600)

    # Outbound email, on app state for the buckets' reason — every create_app() gets
    # a sender of its own, so no test can send real mail and any test can read what
    # was sent by swapping in a recorder. Which sender is settings' call (mail.py).
    app.state.email_sender = create_email_sender()

    # The breach corpus, on app state for the sender's reason — a checker per app, so no
    # test reaches a third party and any test can answer for the corpus itself.
    app.state.breach_checker = create_breach_checker()

    app.include_router(auth.router)
    app.include_router(player_auth.router)
    app.include_router(coaches.router)
    app.include_router(players.router)
    app.include_router(analytics.router)
    app.include_router(analytics.match_router)
    app.include_router(matches.router)

    # A Mount rather than a route, and so absent from the spec: only APIRoutes reach the
    # generator, and a generated client function would invite constructing a photo URL
    # instead of reading the one the resource it belongs to already carries.
    app.mount(MEDIA_PATH, mount_media(), name="media")

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
