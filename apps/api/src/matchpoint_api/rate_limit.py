"""Arrival-rate limiting, for routes that spend real work on unauthenticated requests.

Sign-up burns ~165 ms of CPU and 64 MiB on Argon2 per request (`security.py`), and a
request beyond the two hashing slots parks its worker thread on the semaphore — a thread
taken from the pool every `def` route in the app shares. The semaphore bounds how many
hashes run at once; this module bounds how fast such requests are admitted at all, which
is the job `security.py` explicitly leaves to rate limiting.

A token bucket rather than a fixed window, because what parks the threadpool is a burst
and a window bounds only the average: it admits its whole allowance in one instant, and
twice that straddling a boundary. A bucket's `burst` is a hard cap on the instantaneous
queue, and its refill rate the sustained one.

The counters live in process memory, deliberately. There is one api container
(`infra/prod/compose.yml`), so there is no second process to share them with, and a
deploy emptying the buckets grants a minute of grace, not a correctness bug. Postgres
would survive the restart but put a write on the hot path of exactly the flood being
shed, and Redis is a new stateful service for club-scale traffic. The proxy could limit
instead, but Caddy's rate_limit module is not in the stock build, a proxy cannot key on
an account the way login (#24) needs, and an app-level 429 is a declared, tested response
shape rather than proxy behaviour the test suite never sees.
"""

import math
import threading
import time

from fastapi import HTTPException

# One lock for every bucket in the process rather than one per limiter, so a request
# counted against several buckets can read them all and spend them all without another
# thread slipping in between — see `take_all`. The critical section is dict arithmetic
# over a couple of keys, so what this costs in contention over a lock apiece is noise.
_lock = threading.Lock()


class RateLimiter:
    """A token bucket per key, spending one token per admitted request.

    A key's bucket starts at `burst` tokens and refills at `per_minute / 60` a second, so
    `burst` bounds what a key can do in an instant and `per_minute` what it can sustain.
    Keys are opaque strings: a client address for a per-caller limit, a constant for a
    route-wide one, an email for login's per-account limit.

    Thread-safe, because every route in this app runs on the shared threadpool.
    """

    def __init__(self, *, per_minute: float, burst: int) -> None:
        self._rate = per_minute / 60
        self._burst = burst
        # key -> (tokens remaining, the monotonic instant they were counted at)
        self._buckets: dict[str, tuple[float, float]] = {}
        self._pruned_at = -math.inf

    def take(self, key: str) -> None:
        """Admit one request for `key`, or raise the 429 that refuses it.

        The refusal carries Retry-After, so a client that would rather wait than fail
        knows when a token will exist — and it spends nothing, so hammering a drained
        bucket never pushes the retry point further out than the deficit already is.
        `take_all` is what keeps that promise true when a request is counted against
        more than one bucket.
        """
        take_all((self, key))

    def refund(self, key: str) -> None:
        """Give `key` back the token it spent, for a request whose cost never landed.

        For a tier that meters something a request can be admitted and still fail to do —
        request-otp's send, whose cost is an email a provider failure means nobody
        received. Keeping that charged turns a provider's bad minute into a lockout: the
        502 tells the coach to try again, and the tier they have now paid three times for
        nothing refuses the attempt for five minutes.

        Only the tier whose cost went unspent is refunded. The tiers metering arrivals
        stay charged — that work happened either way — and they are also what stops a
        reliably refundable failure (an address the provider always refuses) from being
        an unmetered path back into this endpoint.
        """
        now = time.monotonic()
        with _lock:
            # A key that is absent has a full bucket and so nothing owed back; putting
            # one in would only hand `_prune` something to take straight out again.
            if key not in self._buckets:
                return
            self._buckets[key] = (min(float(self._burst), self._tokens_at(key, now) + 1), now)

    def _tokens_at(self, key: str, now: float) -> float:
        """What `key` has to spend at `now` — refilled, but nothing taken off it yet.

        The caller holds `_lock`. Reading without spending is what lets `take_all`
        refuse a request without charging any of the buckets it was refused by.
        """
        if key not in self._buckets and now - self._pruned_at >= 1 / self._rate:
            self._prune(now)
        tokens, counted_at = self._buckets.get(key, (float(self._burst), now))
        return min(float(self._burst), tokens + (now - counted_at) * self._rate)

    def _wait_for(self, tokens: float) -> float:
        """Seconds until `tokens` reaches the one token an admitted request spends.

        Split out of `_refusal` so that `take_all` can compare tiers before refusing:
        the deficit alone does not say which bucket is furthest away, because the tiers
        refill at different rates.
        """
        return (1 - tokens) / self._rate

    def _refusal(self, tokens: float) -> HTTPException:
        return HTTPException(
            status_code=429,
            detail="Too many requests",
            headers={"Retry-After": str(math.ceil(self._wait_for(tokens)))},
        )

    def _prune(self, now: float) -> None:
        """Drop every bucket that has refilled to full, which a fresh key equals anyway.

        Run when a new key arrives, so the dict tracks the keys seen recently rather than
        every key ever seen — an attacker cycling addresses otherwise grows it without
        bound. The scan is linear in the dict, and nothing can refuse the insertion that
        triggers it, so `_tokens_at` runs it at most once per refill interval rather than
        once per arrival: the total cost stays linear in arrivals instead of squaring.
        Deferring cannot strand a full bucket, since a bucket enters the dict having spent
        at least one token, and earning that token back takes a whole interval too.
        """
        self._pruned_at = now
        self._buckets = {
            key: (tokens, counted_at)
            for key, (tokens, counted_at) in self._buckets.items()
            if now - counted_at < (self._burst - tokens) / self._rate
        }


def take_all(*buckets: tuple[RateLimiter, str]) -> None:
    """Admit one request against every (limiter, key) pair, or refuse it spending nothing.

    Counting one request against two tiers has to be all-or-nothing. Charging the first
    tier before asking the second would leave a token spent on a request that was never
    admitted, and the client cannot see it: it is handed the refusing tier's Retry-After,
    so obeying the header exactly drains the *other* bucket until that one refuses too —
    the better behaved the client, the longer it stays locked out. So every bucket is read
    first and only charged once all of them can pay.

    The refusal is the empty bucket furthest from a token, not the first one listed. A
    nearer tier's Retry-After sends the same obedient client back to be refused by a tier
    it was never told about — the same trap one step later, and the deficits alone do not
    rank the tiers because they refill at different rates. Callers may therefore list
    their tiers in any order.
    """
    now = time.monotonic()
    with _lock:
        levels = [(limiter, key, limiter._tokens_at(key, now)) for limiter, key in buckets]
        empty = [(limiter, tokens) for limiter, _key, tokens in levels if tokens < 1]
        if empty:
            limiter, tokens = max(empty, key=lambda bucket: bucket[0]._wait_for(bucket[1]))
            raise limiter._refusal(tokens)
        for limiter, key, tokens in levels:
            limiter._buckets[key] = (tokens - 1, now)
