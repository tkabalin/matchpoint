import secrets
from datetime import UTC, datetime
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from matchpoint_api.auth import (
    OTP_ATTEMPT_LIMIT,
    OTP_LIFETIME,
    SESSION_COOKIE,
    SESSION_LIFETIME,
    VERIFICATION_LIFETIME,
    hash_otp,
    hash_token,
    new_otp,
    new_session_token,
    set_session_cookie,
    set_verification_cookie,
)
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.mail import EmailSender, EmailSendError
from matchpoint_api.models import Coach, CoachSession, EmailVerification
from matchpoint_api.rate_limit import RateLimiter, take_all
from matchpoint_api.schemas.auth import LoginRequest, OtpRequest, VerifyOtpRequest
from matchpoint_api.schemas.coach import CoachRead
from matchpoint_api.schemas.errors import ErrorDetail
from matchpoint_api.security import DUMMY_HASH, hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db)]

# One message for an unknown email and a wrong password, on purpose: which of the two
# it was is exactly what a response must not disclose (the timing defence below is the
# other half of the same promise).
INCORRECT_CREDENTIALS = "Incorrect email or password"


def limit_login_rate(request: Request) -> None:
    """Refuse logins beyond a bounded arrival rate, before any password is verified.

    Sign-up's two tiers over again, keyed and sized the same way (`create_app` sizes
    both), and listed in the decorator's `dependencies` for the same reason: a refused
    request costs no body validation, no database session, and above all no Argon2 run.
    The address is a Cloudflare edge one an attacker can occupy many of, so it is the
    shared bucket that actually bounds what reaches Argon2.

    What guards an individual account is not here but in `reject_login`, because the
    question it answers — was this password wrong — is one only the handler can ask.
    """
    per_ip: RateLimiter = request.app.state.login_per_ip_limit
    total: RateLimiter = request.app.state.login_total_limit
    take_all((per_ip, request.client.host if request.client else ""), (total, "total"))


def reject_login(request: Request, email: str) -> NoReturn:
    """Refuse this attempt, charging it to the account's budget of wrong guesses.

    An unbounded login is a password-guessing oracle per *account*, not per address, and
    the tiers above cannot see accounts. This one is keyed on the submitted address —
    folded the way the row lookup folds it, or casing would mint fresh buckets — whether
    or not a row lives there, so an unknown email is charged exactly as a wrong password
    is and the 429 discloses nothing about which addresses hold accounts.

    Only a failed verification is charged, and a correct password never reaches here at
    all. That is what keeps a per-account bound from being an account-lockout lever:
    counting arrivals instead would let anyone who knows a coach's email — which
    sign-up's 409 hands out — spend each token as it refilled and keep that coach signed
    out for good. A guess is by definition wrong, so the tier gives up nothing by
    ignoring the requests that turn out right.

    The price is that a drained bucket no longer skips the Argon2 run, since the
    verification is what decides whether to charge it. What reaches Argon2 stays bounded
    by `limit_login_rate` either way, so this costs the account's attacker time, not the
    box's threads.
    """
    per_account: RateLimiter = request.app.state.login_per_account_limit
    per_account.take(email)  # the 429, once this account has spent its guesses
    raise HTTPException(status_code=401, detail=INCORRECT_CREDENTIALS)


# The 401 is declared because the login form has to branch on "wrong credentials",
# just as sign-up's 409 is — and declared with a model for ErrorDetail's reason.
@router.post(
    "/login",
    response_model=CoachRead,
    dependencies=[Depends(limit_login_rate)],
    responses={
        401: {"model": ErrorDetail, "description": INCORRECT_CREDENTIALS},
        429: {"model": ErrorDetail, "description": "Too many login attempts"},
    },
)
def login(data: LoginRequest, request: Request, db: DbSession, response: Response) -> Coach:
    # lower() folds the whole address because rows are stored lowercased and EmailStr
    # folds only the domain — a coach signing in as MIKE@ must find mike@'s row. The
    # per-account bucket keys on the same folding, so it must happen before reject_login.
    email = data.email.lower()
    coach = db.scalar(select(Coach).where(Coach.email == email))
    password = data.password.get_secret_value()
    if coach is None:
        # Burn the verification a real account would have cost. Skipping it would
        # answer "no such account" measurably faster than "wrong password", and the
        # difference is an oracle for which emails hold accounts. The result is
        # ignored: DUMMY_HASH matches nothing anyone can submit.
        verify_password(password, DUMMY_HASH)
        reject_login(request, email)
    if not verify_password(password, coach.password_hash):
        reject_login(request, email)
    # The one moment the plaintext and a database session are both in hand, so it is
    # here that a change to security.py's parameters reaches rows hashed before it.
    if needs_rehash(coach.password_hash):
        coach.password_hash = hash_password(password)
    now = datetime.now(UTC)
    # Signing in is the one moment this coach's own dead rows are cheap to find — the
    # foreign key's index already narrows to them — so the login that would add to the
    # pile clears it instead. It bounds only what a returning coach left behind: rows
    # belonging to a coach who never logs in again still have nothing to delete them,
    # and a session abandoned while still live waits out its full lifetime either way.
    db.execute(
        delete(CoachSession).where(
            CoachSession.coach_id == coach.id, CoachSession.expires_at <= now
        )
    )
    token = new_session_token()
    db.add(
        CoachSession(
            coach_id=coach.id,
            token_hash=hash_token(token),
            expires_at=now + SESSION_LIFETIME,
        )
    )
    db.commit()
    set_session_cookie(response, token)
    return coach


# 204 whether or not the cookie named a live session: logout is a request for a state
# ("signed out") rather than an action on a resource, and that state is reached either
# way. Failing on an already-dead session would only make double-clicks and retries
# into errors.
@router.post("/logout", status_code=204)
def logout(request: Request, db: DbSession, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token is not None:
        db.execute(delete(CoachSession).where(CoachSession.token_hash == hash_token(token)))
        db.commit()
    # Deleting the row is the revocation; clearing the cookie just stops the browser
    # presenting a corpse. The flags must match the ones the cookie was set with, or
    # the browser treats it as a different cookie and keeps the original.
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )


# Sign-up email verification (#43, #35): request-otp emails a code, verify-otp trades
# it for the short-lived cookie that POST /coaches will demand (#44). The contract —
# 202 on send, 409 on a registered address — is pinned by sign-up form code already
# shipped on main, not open for design here.

INCORRECT_CODE = "Incorrect or expired code"

# Distinct from every other failure this endpoint has, because it is the only one the
# caller can do nothing about and should simply try again — the form says so rather than
# leaving a coach waiting on the next screen for mail that was never accepted.
SEND_FAILED = "Couldn't send that code, please try again"


def _incorrect_code() -> HTTPException:
    # One 400 for a wrong code, an expired one, a spent attempt budget and an address
    # nobody asked a code for: to the caller they are one fact ("that code didn't
    # work"), and distinguishing them would describe the server's bookkeeping to
    # whoever is probing — including whether an address is mid-sign-up.
    #
    # The body says one thing; the work behind it does not. A matched row is charged an
    # attempt and sometimes deleted, where an unknown address writes nothing, so the two
    # remain separable by timing. Login closes its equivalent by burning a verification
    # it does not need; there is no equivalent here, because the work to equalise would
    # be a row written for every address anyone cares to probe.
    return HTTPException(status_code=400, detail=INCORRECT_CODE)


# The 409 is declared for the same reason sign-up's is: the form branches on it,
# inline on the email field. The cost of telling an unauthenticated caller whether an
# address holds an account is a tradeoff this endpoint now owns alone (#47 owns
# revisiting it): /coaches' own 409 stopped being reachable without a verification
# cookie when #44 landed, so this is where that question lives.
@router.post(
    "/request-otp",
    status_code=202,
    responses={
        409: {"model": ErrorDetail, "description": "Email already registered"},
        429: {"model": ErrorDetail, "description": "Too many codes requested"},
        502: {"model": ErrorDetail, "description": SEND_FAILED},
    },
)
def request_otp(data: OtpRequest, request: Request, db: DbSession) -> None:
    # lower() folds the whole address as login does: the verification row, the coach
    # row and the per-email bucket must all agree on what MIKE@ names.
    email = data.email.lower()
    # At the top of the handler rather than in the decorator's dependencies, because
    # the per-email key needs the parsed body — login's position, for login's reason.
    # The cost bounded here is not sign-up's CPU but outbound email: provider quota,
    # a young sending domain's reputation, and strangers' inboxes. The per-email tier
    # is also load-bearing for guessing — five attempts per code means little if codes
    # can be minted without bound — and it meters probes of registered addresses the
    # same, so the 409 below cannot be farmed for enumeration at arrival rate.
    per_email: RateLimiter = request.app.state.request_otp_per_email_limit
    per_ip: RateLimiter = request.app.state.request_otp_per_ip_limit
    total: RateLimiter = request.app.state.request_otp_total_limit
    take_all(
        (per_email, email),
        (per_ip, request.client.host if request.client else ""),
        (total, "total"),
    )
    now = datetime.now(UTC)
    # The whole table's expired rows, not just this address's: the upsert below
    # already bounds the table to addresses ever seen, and this sweep tightens that
    # to addresses seen within an expiry window. Here rather than on a hot path —
    # this endpoint is rate-limited and about to do a network send, so a bounded
    # DELETE is noise, which is exactly the objection (#41) that ruled out sweeping
    # expired sessions at login.
    db.execute(delete(EmailVerification).where(EmailVerification.expires_at <= now))
    # A pre-check SELECT, where sign-up catches IntegrityError — a deliberate
    # departure from that rule, whose rationale is the unique-constraint race: two
    # requests both passing a pre-check and one losing the INSERT. No such race exists
    # here, because email_verifications accepts the row either way; someone
    # registering between this check and their sign-up still meets /coaches' own 409.
    # The timing gap between this branch and the 202's hash-upsert-send is a kept
    # oracle: the 409 itself already answers the same question, openly.
    if db.scalar(select(Coach.id).where(Coach.email == email)) is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    otp = new_otp()
    fresh = {
        "otp_hash": hash_otp(otp),
        # Not only a fresh code for a row still at the code stage: an address that has
        # already answered its code is put back to the code stage too, so the
        # verification cookie it earned stops working. That is the rule this endpoint
        # means — asking for a code resets the address to unproven — and it is the
        # kinder of the two options, since refusing the request would strand a coach
        # who genuinely lost the cookie behind an endpoint that cannot say why.
        "token_hash": None,
        "attempts": 0,
        "expires_at": now + OTP_LIFETIME,
    }
    # An upsert rather than insert-or-update in Python: two concurrent requests for
    # one address must both land on the single row, and the loser of the INSERT must
    # overwrite rather than raise. Replacing the row is what makes a resend *replace*
    # the old code — one live code per address, always. updated_at is set by hand
    # because ON CONFLICT is an INSERT to SQLAlchemy, so the column's onupdate
    # never fires for it.
    db.execute(
        insert(EmailVerification)
        .values(email=email, **fresh)
        .on_conflict_do_update(
            index_elements=[EmailVerification.email],
            set_={**fresh, "updated_at": func.clock_timestamp()},
        )
    )
    db.commit()
    # After the commit, so a code that failed to store is never mailed. The reverse
    # failure — stored but the send blows up — is the 502 below, and the retry that
    # follows replaces the row anyway.
    #
    # Inline, not a BackgroundTask. Deferring the send would put the 202 on the wire
    # before the provider was called, which makes the 502 unreachable: the failure
    # could only ever reach the log, leaving a coach parked on the code-entry screen
    # waiting for mail that is never coming. That is the worse outcome, so the cost is
    # accepted instead — provider latency sits in the request holding a threadpool
    # thread, bounded by mail.py's RESEND_TIMEOUT and by the three tiers above.
    sender: EmailSender = request.app.state.email_sender
    try:
        sender.send(
            to=email,
            subject="Your MatchPoint sign-up code",
            text=f"Your sign-up code is {otp}. "
            f"It expires in {int(OTP_LIFETIME.total_seconds()) // 60} minutes.",
        )
    except EmailSendError:
        # What this discloses is whether the provider accepted a message, not whether an
        # account exists. The row stays: it expires on its own, and a retry overwrites it.
        #
        # The per-email token goes back, because that tier meters mail to an inbox and
        # this message never reached one — charged, three provider failures would spend
        # the budget and refuse the retry this 502 asks for. Only that tier: the arrival
        # tiers paid for work that did happen, and they keep the refund from being an
        # unmetered way back in here.
        per_email.refund(email)
        raise HTTPException(status_code=502, detail=SEND_FAILED) from None


def limit_verify_otp_rate(request: Request) -> None:
    """Bound guess arrivals — the second layer, not the bound itself.

    What actually caps guessing a given code is its row's attempt budget, counted in
    the database where a deploy cannot refill it. That budget is third-party drainable:
    anyone who knows an address can spend its five guesses and then hold request-otp's
    per-email bucket drained, denying sign-up — the same shape removed from login's
    per-account tier, but unfixable here because a guess IS a failed verification.
    These tiers just keep the arrivals themselves bounded, as every unauthenticated
    endpoint's are. In the decorator's dependencies like sign-up's, since no tier here
    needs the parsed body: a refused guess costs no validation and no session.
    """
    per_ip: RateLimiter = request.app.state.verify_otp_per_ip_limit
    total: RateLimiter = request.app.state.verify_otp_total_limit
    take_all((per_ip, request.client.host if request.client else ""), (total, "total"))


@router.post(
    "/verify-otp",
    dependencies=[Depends(limit_verify_otp_rate)],
    responses={
        400: {"model": ErrorDetail, "description": INCORRECT_CODE},
        429: {"model": ErrorDetail, "description": "Too many attempts"},
    },
)
def verify_otp(data: VerifyOtpRequest, db: DbSession, response: Response) -> None:
    email = data.email.lower()
    now = datetime.now(UTC)
    # Find the row and charge the guess in one statement, before the code is compared.
    # Reading first and charging after would bound the counter but not the guessing:
    # every request that read the row before anyone's increment landed would still get
    # its comparison, so the real cap would be however many guesses arrive together —
    # the per-address burst — rather than OTP_ATTEMPT_LIMIT. Charging first also takes
    # the row's lock for the rest of this transaction, which is what leaves the success
    # path below a single winner.
    #
    # The two conditions beyond the address are 400s that used to be read off the
    # loaded row: a row already traded for a token has no code left to answer, and an
    # expired one is not answerable either. Matching nothing is how they arrive there
    # now, and neither is charged an attempt it has no budget left to spend.
    charged = db.execute(
        update(EmailVerification)
        .where(
            EmailVerification.email == email,
            EmailVerification.otp_hash.is_not(None),
            EmailVerification.expires_at > now,
        )
        .values(attempts=EmailVerification.attempts + 1)
        .returning(EmailVerification.id, EmailVerification.otp_hash, EmailVerification.attempts)
    ).one_or_none()
    # one_or_none rather than one: a concurrent guess that spent the last of the budget
    # deletes the row, and this UPDATE then matches nothing. Raising there would answer
    # a 500 where the caller is owed the same 400 as every other failure — and a 500
    # arriving exactly when the budget ran out is itself the fact _incorrect_code
    # exists to withhold.
    if charged is None:
        raise _incorrect_code()
    # _tuple() rather than unpacking the Row itself: the underscore is SQLAlchemy's own
    # naming (a column could be called `tuple`), and it is what keeps these three typed
    # instead of Any, so the fallback below is a real narrowing and not decoration.
    row_id, otp_hash, attempts = charged._tuple()
    # compare_digest because unlike current_coach's lookup, which compares in a SQL
    # WHERE, this row was found by email and the comparison happens in Python. The
    # column is typed optional because it is nullable, but the WHERE above matched on
    # it being present; "" stands for that impossible case and matches no digest.
    if not secrets.compare_digest(otp_hash or "", hash_otp(data.otp.get_secret_value())):
        if attempts >= OTP_ATTEMPT_LIMIT:
            # The budget is spent, and the row dies with it: the address goes back
            # to "no code outstanding", and a fresh request-otp (its own limiter
            # permitting) is the only way forward.
            db.execute(delete(EmailVerification).where(EmailVerification.id == row_id))
        db.commit()
        raise _incorrect_code()
    token = new_session_token()
    # One UPDATE, so the code dies the instant it works: no window where code and token
    # are both answerable, held by the table's exactly-one-secret CHECK. A second
    # request answering the same code blocked on the lock the charge took, and
    # re-evaluates its own `otp_hash IS NOT NULL` against this row once we commit — so
    # it matches nothing and is refused, rather than minting a second token and leaving
    # whichever response the browser stored last holding a dead one.
    db.execute(
        update(EmailVerification)
        .where(EmailVerification.id == row_id)
        .values(
            otp_hash=None,
            token_hash=hash_token(token),
            attempts=0,
            expires_at=now + VERIFICATION_LIFETIME,
        )
    )
    db.commit()
    set_verification_cookie(response, token)
