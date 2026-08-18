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
    RESET_COOKIE,
    SESSION_COOKIE,
    SESSION_LIFETIME,
    VERIFICATION_LIFETIME,
    RecoveryCoach,
    hash_otp,
    hash_token,
    new_otp,
    new_session_token,
    revoke_sessions,
    set_reset_cookie,
    set_session_cookie,
    set_verification_cookie,
)
from matchpoint_api.breach import BreachChecker
from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.mail import EmailSender, EmailSendError
from matchpoint_api.models import Coach, CoachSession, EmailVerification, PasswordReset
from matchpoint_api.password_policy import REJECTION, check_password
from matchpoint_api.rate_limit import RateLimiter, client_key, take_all
from matchpoint_api.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    OtpRequest,
    ResetPasswordRequest,
    VerifyOtpRequest,
    VerifyResetCodeRequest,
)
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
    take_all((per_ip, client_key(request)), (total, "total"))


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


# 204 whether or not this coach had other sessions, for logout's reason: the request
# asks for a state, and a coach signed in nowhere else is already in it. The 401 is
# declared per-route, with a model for ErrorDetail's reason; the 429 is the recovery
# budget `recovery_coach` charges.
#
# RecoveryCoach and not CurrentCoach because this is the route that ends a thief's
# access, so it must not be reachable only while the budget their traffic shares with
# the coach has a token left (#121). Two indexed statements is the whole cost here, so
# that budget is also the only tier this route needs.
@router.delete(
    "/sessions",
    status_code=204,
    responses={
        401: {"model": ErrorDetail, "description": "Not signed in"},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def revoke_other_sessions(coach: RecoveryCoach, request: Request, db: DbSession) -> None:
    """Sign out every other client holding a session for this coach.

    The calling device stays signed in, on a session issued here rather than the one it
    arrived with. A coach revoking after a borrowed laptop or a lost phone does so from
    the device in their hand, and dropping that one mid-action would be the wrong
    surprise.
    """
    # The presented session goes with the rest, rather than being spared by its hash: a
    # thief holding a copy of this cookie authenticates against that same row, and it is
    # exactly their access this route exists to end.
    revoke_sessions(db, coach.id)
    # So the device that asked keeps working, holding a token no copy of the old one
    # matches.
    token = new_session_token()
    db.add(
        CoachSession(
            coach_id=coach.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + SESSION_LIFETIME,
        )
    )
    db.commit()
    # Sent by the renewal middleware, for the reason its docstring gives. Writing where
    # current_coach's renewal writes is what keeps the two from both setting the cookie:
    # this runs after that dependency, so the token the browser is handed is this one.
    request.state.renewed_session_token = token


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
# address holds an account is a tradeoff this endpoint now owns alone (the policy and
# its price: docs/security.md): /coaches' own 409 stopped being reachable without a
# verification cookie when #44 landed, so this is where that question lives.
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
    # also caps guessing — five attempts per code means little if codes
    # can be minted without bound — and it meters probes of registered addresses the
    # same, so the 409 below cannot be farmed for enumeration at arrival rate.
    per_email: RateLimiter = request.app.state.request_otp_per_email_limit
    per_ip: RateLimiter = request.app.state.request_otp_per_ip_limit
    total: RateLimiter = request.app.state.request_otp_total_limit
    take_all(
        (per_email, email),
        (per_ip, client_key(request)),
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
    take_all((per_ip, client_key(request)), (total, "total"))


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


def set_password(
    db: Session, coach: Coach, new_password: str, *, breach_checker: BreachChecker
) -> None:
    """Give this coach a new password, and retire what the old one left behind.

    The one password write, whichever proof got here: an emailed code, or the current
    password. Every session and any live reset row go with the old password, all being
    credentials it left standing; that row is unique on coach_id, so there is at most
    one. No commit, for revoke_sessions' reason.

    The policy check (#141, #140) sits here rather than at each caller, so the one password
    write is also the one place a password can fail policy. It raises before anything
    below runs and nothing here commits, so a refused password leaves the reset row and
    its attempt charge to roll back with the request: the code the coach was handed
    still works on the next try.
    """
    check_password(
        new_password,
        email=coach.email,
        display_name=coach.display_name,
        breach_checker=breach_checker,
    )
    coach.password_hash = hash_password(new_password)
    db.execute(delete(PasswordReset).where(PasswordReset.coach_id == coach.id))
    revoke_sessions(db, coach.id)


# Forgot password (#50, #149): forgot-password emails a code to a registered address,
# verify-reset-code trades the code for a cookie, and reset-password trades that cookie
# for a new password. Sign-up's three stages, and the same reasons for each.


# 202 whether or not the address holds an account (#47's policy for reset, built in
# from the start): unlike sign-up's 409 no form needs the distinction — a coach who
# typoed their address just gets no mail. What the uniform answer cannot hide is
# timing (the known address does an upsert and a send), a kept oracle for request-otp's
# reason: its 409 answers the same question openly, metered by the same tier sizes.
@router.post(
    "/forgot-password",
    status_code=202,
    responses={
        429: {"model": ErrorDetail, "description": "Too many codes requested"},
        502: {"model": ErrorDetail, "description": SEND_FAILED},
    },
)
def forgot_password(data: ForgotPasswordRequest, request: Request, db: DbSession) -> None:
    # lower() folds the whole address as login does: the coach lookup and the
    # per-email bucket must agree on what MIKE@ names.
    email = data.email.lower()
    # In the handler for request-otp's reason (the per-email key needs the parsed
    # body), bounding request-otp's cost — outbound email, quota, reputation — which
    # this endpoint, unlike request-otp behind its 409, can aim at a registered
    # coach's inbox. The per-email tier also meters code minting per account, which
    # is what keeps the row's attempt budget meaning something.
    #
    # Charged on arrival, so knowing an address can hold its bucket drained — the
    # lockout shape login's budget designed out. Accepted here because every charged
    # request mails the owner the code that now works: what a stranger can deny is
    # the asking, not the recovering.
    per_email: RateLimiter = request.app.state.forgot_password_per_email_limit
    per_ip: RateLimiter = request.app.state.forgot_password_per_ip_limit
    total: RateLimiter = request.app.state.forgot_password_total_limit
    take_all(
        (per_email, email),
        (per_ip, client_key(request)),
        (total, "total"),
    )
    now = datetime.now(UTC)
    # The whole table's expired rows, at request-otp's site for request-otp's reason:
    # rate-limited and about to do a network send, so a bounded DELETE is noise.
    db.execute(delete(PasswordReset).where(PasswordReset.expires_at <= now))
    coach_id = db.scalar(select(Coach.id).where(Coach.email == email))
    if coach_id is None:
        # The sweep still lands — this commit is all the unknown address gets.
        db.commit()
        return
    otp = new_otp()
    fresh = {
        "otp_hash": hash_otp(otp),
        # Not only a fresh code for a row still at the code stage: an account that has
        # already answered its code is put back to the code stage too, so the reset
        # cookie it earned stops working. request-otp's rule and its reasons, and the
        # table's exactly-one-secret CHECK makes it mandatory rather than a choice.
        "token_hash": None,
        "attempts": 0,
        "expires_at": now + OTP_LIFETIME,
    }
    # An upsert on coach_id, exactly as request-otp upserts on email: concurrent
    # requests must land on the single row, and a resend must *replace* the old code —
    # one live code per account, always. Anyone can trigger the replacement, killing a
    # code the coach is mid-typing — accepted, since the replacement is mailed to the
    # same inbox. updated_at by hand because ON CONFLICT is an INSERT to SQLAlchemy,
    # so onupdate never fires for it.
    db.execute(
        insert(PasswordReset)
        .values(coach_id=coach_id, **fresh)
        .on_conflict_do_update(
            index_elements=[PasswordReset.coach_id],
            set_={**fresh, "updated_at": func.clock_timestamp()},
        )
    )
    db.commit()
    # After the commit and inline, for request-otp's reasons: never mail a code that
    # failed to store, and never 202 before the provider has actually accepted.
    sender: EmailSender = request.app.state.email_sender
    try:
        sender.send(
            to=email,
            subject="Your MatchPoint password reset code",
            text=f"Your password reset code is {otp}. "
            f"It expires in {int(OTP_LIFETIME.total_seconds()) // 60} minutes. "
            "If you didn't ask to reset your password, you can ignore this email.",
        )
    except EmailSendError:
        # The row stays and the per-email token goes back, as at request-otp: that
        # tier meters mail to an inbox and this message never reached one.
        per_email.refund(email)
        raise HTTPException(status_code=502, detail=SEND_FAILED) from None


def limit_verify_reset_code_rate(request: Request) -> None:
    """Bound guess arrivals — the second layer, not the bound itself.

    The real cap on guessing a code is its row's attempt budget, counted in the
    database where a deploy cannot refill it. That budget is third-party drainable,
    as verify-otp's is: five junk guesses from anyone who knows the address kill a
    live code. The stake here is a coach's recovery, not a stranger's sign-up, and
    it is weighed rather than inherited — a guess IS a failed verification, so
    login's charge-after-failure fix cannot transfer, and the code cannot afford a
    looser cap when its prize is the account. What keeps the drain harassment
    rather than closure is that a killed code is one forgot-password away from
    replaced, with every kill announced by the mail it forces. The design that
    removes the lever outright is an unguessable emailed link; the six-digit code
    was chosen with eyes open, for sign-up's autofill reasons.

    In the decorator's dependencies since no tier here needs the parsed body.
    """
    per_ip: RateLimiter = request.app.state.verify_reset_code_per_ip_limit
    total: RateLimiter = request.app.state.verify_reset_code_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))


# verify-otp's endpoint against this table (#149), and the reason the flow has two steps
# at all: a wrong code becomes a failure of its own screen, answered before the coach has
# typed a new password. A comment rather than more of the docstring, because a docstring
# is published API description and this is our own bookkeeping.
@router.post(
    "/verify-reset-code",
    dependencies=[Depends(limit_verify_reset_code_rate)],
    responses={
        400: {"model": ErrorDetail, "description": INCORRECT_CODE},
        429: {"model": ErrorDetail, "description": "Too many attempts"},
    },
)
def verify_reset_code(data: VerifyResetCodeRequest, db: DbSession, response: Response) -> None:
    """Answer a reset code without spending it, for the cookie reset-password demands.

    A code that is wrong, expired, already answered, or asked for an address holding no
    account all answer the same 400, so nothing here says whether an account exists.
    """
    email = data.email.lower()
    now = datetime.now(UTC)
    # An unknown address takes _incorrect_code's one 400 like every other failure
    # here: nobody asked a code for it, so no code can be right. The extra query a
    # known address then runs is timing-separable, verify-otp's kept oracle again.
    coach_id = db.scalar(select(Coach.id).where(Coach.email == email))
    if coach_id is None:
        raise _incorrect_code()
    # Find the row and charge the guess in one statement, before the code is
    # compared — verify-otp's move, for verify-otp's reasons: charging after a read
    # would cap the counter but not the guessing, and the row lock this takes is
    # what leaves the success path below a single winner. A row already traded for a
    # token has no code left to answer, so it matches nothing here.
    charged = db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.coach_id == coach_id,
            PasswordReset.otp_hash.is_not(None),
            PasswordReset.expires_at > now,
        )
        .values(attempts=PasswordReset.attempts + 1)
        .returning(PasswordReset.id, PasswordReset.otp_hash, PasswordReset.attempts)
    ).one_or_none()
    if charged is None:
        raise _incorrect_code()
    row_id, otp_hash, attempts = charged._tuple()
    # The column is typed optional because it is nullable, but the WHERE above matched
    # on it being present; "" stands for that impossible case and matches no digest.
    if not secrets.compare_digest(otp_hash or "", hash_otp(data.otp.get_secret_value())):
        if attempts >= OTP_ATTEMPT_LIMIT:
            # Budget spent, row dies: back to "no reset outstanding", and a fresh
            # forgot-password (its own limiter permitting) is the only way forward.
            db.execute(delete(PasswordReset).where(PasswordReset.id == row_id))
        db.commit()
        raise _incorrect_code()
    token = new_session_token()
    # One UPDATE, so the code dies the instant it works: no window where code and token
    # are both answerable, held by the table's exactly-one-secret CHECK. verify-otp's
    # transition exactly, including the rewritten deadline: the proof gets its own
    # window rather than inheriting whatever the code had left.
    db.execute(
        update(PasswordReset)
        .where(PasswordReset.id == row_id)
        .values(
            otp_hash=None,
            token_hash=hash_token(token),
            attempts=0,
            expires_at=now + VERIFICATION_LIFETIME,
        )
    )
    db.commit()
    set_reset_cookie(response, token)


# One message for a missing cookie, an unknown token, an address the cookie does not
# name, an expired proof and one already spent, as POST /coaches answers its own cookie
# with: to the caller they are the same fact ("answer the code again"), and a 401 rather
# than the code screen's 400 is what tells the form which screen to send them back to.
CODE_NOT_VERIFIED = "Reset code not verified"


def limit_reset_password_rate(request: Request) -> None:
    """Bound the arrival rate on the one Argon2 hash a reset spends.

    Guessing is verify-reset-code's problem now; what is left here is sign-up's, which
    is why the sizes are sign-up's: a caller holding a live reset cookie still reaches a
    password hash, and the cookie is not what bounds how fast they can ask for one. In
    the decorator's dependencies for the same reason as there, so a refused request
    costs no body validation, no database session and no hash.
    """
    per_ip: RateLimiter = request.app.state.reset_password_per_ip_limit
    total: RateLimiter = request.app.state.reset_password_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))


@router.post(
    "/reset-password",
    status_code=204,
    dependencies=[Depends(limit_reset_password_rate)],
    responses={
        400: {"model": ErrorDetail, "description": REJECTION},
        401: {"model": ErrorDetail, "description": CODE_NOT_VERIFIED},
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def reset_password(data: ResetPasswordRequest, request: Request, db: DbSession) -> None:
    """Set the new password, given the cookie verify-reset-code minted.

    A 401 means that cookie is missing, spent, expired, or was earned for a different
    address, so the coach has to answer a code again. A 400 means the code was fine but
    `set_password`'s policy refused the new password. Every live session ends here.
    """
    # From request.cookies rather than a Cookie() parameter, for current_coach's reason:
    # a declared cookie parameter reaches the spec and the generated client's signature.
    token = request.cookies.get(RESET_COOKIE)
    if token is None:
        raise HTTPException(status_code=401, detail=CODE_NOT_VERIFIED)
    email = data.email.lower()
    # Looked up before the cookie is matched, so an unknown address answers exactly as a
    # dead cookie does: the flow's non-disclosure, unchanged by the split.
    coach = db.scalar(select(Coach).where(Coach.email == email))
    if coach is None:
        raise HTTPException(status_code=401, detail=CODE_NOT_VERIFIED)
    # A read rather than the delete POST /coaches matches this against: #141's policy
    # check still has to run below, and a policy-refused password must leave this row
    # standing so the code the coach was mailed still works on the next try. set_password
    # retires it, along with any other row for this coach, once the new password clears
    # that check. The coach is in the WHERE because a cookie proving mike@ must not reset
    # sam@'s password, and because a cookie left over from an earlier address should send
    # the coach back to the code screen rather than quietly resetting the other account.
    consumed = db.scalar(
        select(PasswordReset.id).where(
            PasswordReset.coach_id == coach.id,
            PasswordReset.token_hash == hash_token(token),
            PasswordReset.expires_at > datetime.now(UTC),
        )
    )
    if consumed is None:
        raise HTTPException(status_code=401, detail=CODE_NOT_VERIFIED)
    breach_checker: BreachChecker = request.app.state.breach_checker
    # No session is spared, because the premise of a reset is that someone else may hold
    # the old credential. The row this retires is the one matched above.
    set_password(db, coach, data.new_password.get_secret_value(), breach_checker=breach_checker)
    db.commit()


# Changing a password (#59): reset-password's write again, proved by the current
# password rather than an emailed code.
#
# Asking for that password rather than taking the session on trust is the whole point:
# the cookie proves this browser was signed in once, not that whoever holds it now knows
# the password. Without the check, a stolen session is a permanent account takeover: the
# thief sets a password of their own and the coach cannot even recover to it.
#
# Which is also why it takes RecoveryCoach: a route that exists to end a stolen session's
# access cannot spend from a budget that session's own traffic drains (#121). Its tiers
# below are unchanged: the arrival ones bound the two Argon2 runs, and the wrong-guess one
# is consulted only by a caller who has the password wrong, so a thief draining it with
# guesses still cannot refuse the coach who knows it.

INCORRECT_PASSWORD = "Incorrect password"


@router.post(
    "/change-password",
    status_code=204,
    responses={
        400: {"model": ErrorDetail, "description": REJECTION},
        401: {"model": ErrorDetail, "description": "Not signed in"},
        403: {"model": ErrorDetail, "description": INCORRECT_PASSWORD},
        # Two things now answer 429 here, this route's wrong-guess and arrival tiers and
        # the recovery budget `recovery_coach` charges, so the description is the wider
        # one the body already carries.
        429: {"model": ErrorDetail, "description": "Too many requests"},
    },
)
def change_password(
    data: ChangePasswordRequest, coach: RecoveryCoach, request: Request, db: DbSession
) -> None:
    """Replace this coach's password, given the current one, and end every session.

    The caller keeps working on a freshly issued session cookie. A wrong current password
    answers 403, a missing or dead session 401, and a new password `set_password`'s policy
    refuses 400, that one after the 403, so a wrong current password is what a caller
    getting both wrong hears about first.
    """
    # In the handler, not the decorator's dependencies where the other Argon2-spending
    # routes put theirs: metering after the session resolves stops a stranger draining
    # the shared bucket, and costs nothing, since a 401 reaches no hash anyway.
    per_ip: RateLimiter = request.app.state.change_password_per_ip_limit
    total: RateLimiter = request.app.state.change_password_total_limit
    take_all((per_ip, client_key(request)), (total, "total"))
    if not verify_password(data.password.get_secret_value(), coach.password_hash):
        # A budget of wrong guesses charged only for one, keyed on the account:
        # reject_login's tier for reject_login's reasons, minus its lockout worry, since
        # spending a token here needs a live session for the account it would lock out.
        per_coach: RateLimiter = request.app.state.change_password_per_coach_limit
        per_coach.take(str(coach.id))
        raise HTTPException(status_code=403, detail=INCORRECT_PASSWORD)
    breach_checker: BreachChecker = request.app.state.breach_checker
    # The presented session goes with all the others, as at DELETE /auth/sessions: a
    # thief holding a copy of this cookie authenticates against the same row, so sparing
    # it would leave standing the very access this route exists to end.
    set_password(db, coach, data.new_password.get_secret_value(), breach_checker=breach_checker)
    # A fresh session for the device that just proved the password, so it stays signed in
    # holding a token no copy of the old one matches.
    token = new_session_token()
    db.add(
        CoachSession(
            coach_id=coach.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + SESSION_LIFETIME,
        )
    )
    db.commit()
    # Sent by the renewal middleware, for the reason its docstring gives. Writing where
    # current_coach's renewal writes is what keeps the two from both setting the cookie:
    # this runs after that dependency, so the token the browser is handed is this one.
    request.state.renewed_session_token = token
