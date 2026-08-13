"""Plain-function factories for building model rows in tests.

Rows are flush()ed, not committed, so they stay inside the test's rolled-back
transaction like everything else done through db_session. `verify_email` is the
exception, and says at its own commit why: it stands in for a request that
committed, so a route that rolls back must still find the row afterwards.
"""

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from matchpoint_api.auth import VERIFICATION_COOKIE, hash_token, new_session_token
from matchpoint_api.models import Coach, CoachSession, EmailVerification, Match, Player


def make_coach(session: Session, **overrides: Any) -> Coach:
    # The email is unique per call rather than a fixed address: the column carries a
    # UNIQUE constraint, so a shared default would make the second coach in any one
    # test fail on it.
    #
    # The hash is obvious nonsense, and verify_password would raise InvalidHashError on
    # it. That is the right default: a real one costs ~100 ms per row, which every
    # coach-touching test would pay for nothing, and sign-up produces its own through the
    # route. A test that needs a verifiable hash passes password_hash=hash_password(...).
    coach = Coach(
        **{
            "email": f"coach-{uuid.uuid4()}@example.com",
            "display_name": "Test Coach",
            "password_hash": "not-a-real-hash",
        }
        | overrides
    )
    session.add(coach)
    session.flush()
    return coach


def make_coach_session(session: Session, **overrides: Any) -> CoachSession:
    if "coach_id" not in overrides:
        overrides["coach_id"] = make_coach(session).id
    # The default hash is unique per call, like the coach email above: token_hash
    # carries a UNIQUE constraint. It is a real SHA-256 for shape only — a test that
    # wants a session a request can present computes hash_token over a token it keeps.
    # The expiry is far enough out that a session never dies mid-test; tests about
    # expiry pass their own.
    coach_session = CoachSession(
        **{
            "token_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            "expires_at": datetime.now(UTC) + timedelta(days=30),
        }
        | overrides
    )
    session.add(coach_session)
    session.flush()
    return coach_session


def make_email_verification(session: Session, **overrides: Any) -> EmailVerification:
    # Unique email per call, as make_coach: the column carries a UNIQUE constraint.
    # The default hash is a real SHA-256 for shape only — a test that wants a code a
    # request can answer passes otp_hash=hash_otp(code) over a code it keeps. The
    # expiry is far enough out that a row never dies mid-test; tests about expiry
    # pass their own.
    verification = EmailVerification(
        **{
            "email": f"pending-{uuid.uuid4()}@example.com",
            "otp_hash": hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            "expires_at": datetime.now(UTC) + timedelta(minutes=10),
        }
        | overrides
    )
    session.add(verification)
    session.flush()
    return verification


def verify_email(
    client: TestClient, session: Session, email: str, **overrides: Any
) -> EmailVerification:
    # Gives the client the verification cookie POST /coaches demands, arranged rather
    # than earned through request-otp and verify-otp — for _sign_in's reason (the tests
    # this serves are about sign-up, not the OTP routes) plus one of its own: the real
    # flow would send an email per test. Lowercased as verify-otp lowercases, since the
    # row's CHECK refuses anything else; a test about the case fold submits the mixed
    # case to the route, not here.
    #
    # Committed, unlike the factories above, and like _sign_in: the row stands in for
    # one verify-otp committed, and the route rolls back on its 409 path — a row that
    # was only flushed would vanish with the rollback instead of surviving it.
    token = new_session_token()
    verification = make_email_verification(
        session,
        email=email.lower(),
        otp_hash=None,
        token_hash=hash_token(token),
        **overrides,
    )
    session.commit()
    client.cookies.set(VERIFICATION_COOKIE, token)
    return verification


def make_player(session: Session, **overrides: Any) -> Player:
    player = Player(**{"first_name": "Test", "last_name": "Player"} | overrides)
    session.add(player)
    session.flush()
    return player


def make_match(session: Session, **overrides: Any) -> Match:
    if "player_id" not in overrides:
        overrides["player_id"] = make_player(session).id
    match = Match(**{"played_on": date(2026, 8, 1)} | overrides)
    session.add(match)
    session.flush()
    return match
