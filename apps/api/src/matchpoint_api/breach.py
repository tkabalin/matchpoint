"""Asking whether a chosen password is already in a breach corpus, without sending it.

The checker lives on `app.state`, built in `create_app` like the email sender, so every
test app gets one that cannot reach the wire and any test can answer for the corpus by
swapping in its own. Which checker gets built is `settings.breach_checker`'s choice.

Unlike the email seam the default here is the real one: there is no key whose absence
would catch a box that forgot to configure it, and a deployment silently not checking
looks exactly like one where no coach has picked a breached password yet. A dev box that
would rather not make the call sets MATCHPOINT_BREACH_CHECKER=allow_all.

Only five hex characters of a SHA-1 leave the process, which is what makes asking a third
party about a password defensible; `docs/security.md` records the privacy and fail-open
reasoning, and `password_policy.py` owns the decision about an answer that never came.
"""

import hashlib
import logging
import re
from collections.abc import Callable
from typing import Protocol

import httpx

from matchpoint_api.config import settings

logger = logging.getLogger(__name__)

# A module constant rather than a Settings field, for RESEND_URL's reason: there is one
# corpus, and no account or key behind it to vary. Pinned by a test, which is what
# docs/security.md's SSRF section cites — the host is fixed here and the only variable
# part of the path is a hexdigest slice.
PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range"

# The prefix that gets sent: one bucket in 16**5, holding some 800 hashes of which ours
# is at most one. Fixed by the API, not a tuning knob.
PREFIX_LENGTH = 5

# One row of the answer: the 35 hex characters of a SHA-1 after that prefix, and how many
# times the corpus has seen it. Matched strictly, which is what tells a bucket of real rows
# from a 200 that is not one at all.
SIGHTING = re.compile(r"^([0-9A-F]{35}):(\d+)$")

# Pads every answer out to between 800 and 1,000 rows, so response size says nothing
# about how many hashes the bucket really holds. The padding arrives as rows at count 0,
# which `_is_listed` is careful about.
PWNED_HEADERS = {"Add-Padding": "true", "User-Agent": "MatchPoint"}

# Much shorter than the mail seam's, and explicit because httpx's default is not. At reset
# and change the lookup runs inside the route's open transaction, holding a pooled
# connection and the reset row's lock (`routers/auth.py` says why it cannot be hoisted out),
# so a slow answer costs more than latency: the engine pools 15 connections and those two
# routes admit bursts of 10 each. Three seconds all in, against an endpoint answering from
# Cloudflare's edge in milliseconds, is already generous.
PWNED_TIMEOUT = httpx.Timeout(2.0, connect=1.0)


class BreachCheckError(Exception):
    """The corpus could not be asked, so nothing is known about this password.

    Raised in place of anything httpx-shaped so that the policy layer can decide what an
    unanswered question means without importing httpx or knowing who is behind the seam.
    """


class BreachChecker(Protocol):
    """What the policy needs: whether this exact password is in a breach corpus."""

    def is_breached(self, password: str) -> bool: ...  # pragma: no cover


class AllowAllBreachChecker:
    """Answers no to every password, because it has nothing to answer from.

    The opt-out the test suite pins itself to, and what a dev box uses to stay off the
    network. It is not a weaker check but an absent one, and it behaves like a corpus
    that cannot be reached, which is the case the policy already has to handle.
    """

    def is_breached(self, password: str) -> bool:
        return False


class PwnedPasswordsChecker:
    """Asks Have I Been Pwned's range endpoint, which is free and needs no key.

    No retry, unlike the mail seam's one for a 429: a failure here already falls through
    to allowing the password, so retrying only holds the worker thread twice as long for
    an answer the request can do without.
    """

    def __init__(self, client: httpx.Client | None = None) -> None:
        # One client, so lookups reuse the TLS connection rather than repeating the
        # handshake inside a request. Injectable so the tests can drive a MockTransport
        # through the real path, which is what keeps the suite off a third party.
        self._client = client or httpx.Client(timeout=PWNED_TIMEOUT)

    def is_breached(self, password: str) -> bool:
        # SHA-1 because that is the corpus's format, not because anything here rests on
        # it: the hash is a lookup key for a public list, and the password it stands for
        # is one the caller already holds in full. `usedforsecurity=False` says exactly
        # that, and is what stops a FIPS-mode OpenSSL refusing the call outright.
        digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:PREFIX_LENGTH], digest[PREFIX_LENGTH:]
        try:
            response = self._client.get(f"{PWNED_RANGE_URL}/{prefix}", headers=PWNED_HEADERS)
            response.raise_for_status()
        # HTTPStatusError is an HTTPError, so a refusal and a connection that never got
        # an answer both land here: either way the corpus went unasked.
        except httpx.HTTPError as exc:
            # The status or the failure's name, which is what diagnoses an outage; httpx's
            # own message would add the URL and so the prefix, for nothing. httpx logs
            # that URL itself at INFO, so this is tidiness rather than containment —
            # `docs/security.md` says what the prefix in our logs does and doesn't mean.
            detail = (
                exc.response.status_code
                if isinstance(exc, httpx.HTTPStatusError)
                else type(exc).__name__
            )
            logger.warning("pwned passwords lookup failed: %s", detail)
            raise BreachCheckError(f"pwned passwords lookup failed: {detail}") from exc
        sightings = _sightings(response.text)
        if not sightings:
            # A 200 carrying something other than corpus rows — an intercepting proxy's
            # page, or a change of response format — would otherwise read as "no sighting"
            # and quietly turn the check into a no-op. Answering that the corpus went
            # unasked still lets the password through, but says so.
            raise BreachCheckError("pwned passwords answered with no usable rows")
        return sightings.get(suffix, 0) > 0


def _sightings(body: str) -> dict[str, int]:
    """The `SUFFIX: COUNT` rows of the answer, parsed, junk lines skipped.

    Parsed rather than searched for the suffix, because `Add-Padding` fills the answer with
    rows at count 0: a substring search would read padding as a sighting and refuse
    passwords the corpus has never seen.
    """
    sightings: dict[str, int] = {}
    for line in body.splitlines():
        row = SIGHTING.match(line.strip().upper())
        if row:
            sightings[row[1]] = int(row[2])
    return sightings


def create_breach_checker() -> BreachChecker:
    # A dict for create_email_sender's reason: adding an implementation is one entry, and
    # settings.breach_checker's Literal type is what rejects a name that isn't here, at
    # startup rather than at the first password anyone chooses.
    checkers: dict[str, Callable[[], BreachChecker]] = {
        "allow_all": AllowAllBreachChecker,
        "pwned": PwnedPasswordsChecker,
    }
    return checkers[settings.breach_checker]()
