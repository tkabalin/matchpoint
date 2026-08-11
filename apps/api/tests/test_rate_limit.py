import pytest
from fastapi import HTTPException

from matchpoint_api import rate_limit
from matchpoint_api.rate_limit import RateLimiter, take_all


class Clock:
    """A stand-in for the `time` module whose monotonic() the test sets by hand.

    Refill behaviour is arithmetic over elapsed time, so testing it against the real
    clock would mean sleeping through it — this keeps every case instant and exact.
    """

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(rate_limit, "time", clock)
    return clock


def take_expecting_429(limiter: RateLimiter, key: str) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        limiter.take(key)
    assert caught.value.status_code == 429
    return caught.value


def take_expecting_429_from_all(*buckets: tuple[RateLimiter, str]) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        take_all(*buckets)
    assert caught.value.status_code == 429
    return caught.value


def test_a_key_is_admitted_up_to_the_burst_and_refused_beyond_it(clock: Clock) -> None:
    limiter = RateLimiter(per_minute=60, burst=3)

    for _ in range(3):
        limiter.take("1.2.3.4")

    take_expecting_429(limiter, "1.2.3.4")


def test_the_refusal_says_when_to_retry(clock: Clock) -> None:
    """Retry-After is the deficit at the refill rate: one token a second and an empty
    bucket is one second away from admitting. The header is a string because HTTP headers
    are, and whole seconds because that is the granularity the header speaks."""
    limiter = RateLimiter(per_minute=60, burst=1)
    limiter.take("1.2.3.4")

    refusal = take_expecting_429(limiter, "1.2.3.4")

    assert refusal.detail == "Too many requests"
    assert refusal.headers == {"Retry-After": "1"}


def test_tokens_refill_at_the_sustained_rate(clock: Clock) -> None:
    limiter = RateLimiter(per_minute=60, burst=2)
    limiter.take("1.2.3.4")
    limiter.take("1.2.3.4")

    clock.now = 1.0

    limiter.take("1.2.3.4")
    take_expecting_429(limiter, "1.2.3.4")


def test_an_idle_key_accrues_no_more_than_the_burst(clock: Clock) -> None:
    """The cap is what makes `burst` a bound on the instantaneous queue — without it a
    quiet hour banks an unbounded burst for whoever waits."""
    limiter = RateLimiter(per_minute=60, burst=2)
    limiter.take("1.2.3.4")

    clock.now = 3600.0

    limiter.take("1.2.3.4")
    limiter.take("1.2.3.4")
    take_expecting_429(limiter, "1.2.3.4")


def test_keys_do_not_share_a_bucket(clock: Clock) -> None:
    limiter = RateLimiter(per_minute=60, burst=1)
    limiter.take("1.2.3.4")

    limiter.take("5.6.7.8")


def test_a_refused_request_spends_nothing(clock: Clock) -> None:
    """Hammering a drained bucket must not push the retry point out: the refusals leave
    the bucket exactly as they found it, so the token promised for t=1 is still there."""
    limiter = RateLimiter(per_minute=60, burst=1)
    limiter.take("1.2.3.4")
    for _ in range(10):
        take_expecting_429(limiter, "1.2.3.4")

    clock.now = 1.0

    limiter.take("1.2.3.4")


def test_taking_from_several_buckets_admits_only_when_all_of_them_can_pay(clock: Clock) -> None:
    limiter = RateLimiter(per_minute=60, burst=2)
    drained = RateLimiter(per_minute=60, burst=1)
    take_all((limiter, "1.2.3.4"), (drained, "total"))

    take_expecting_429_from_all((limiter, "1.2.3.4"), (drained, "total"))


def test_a_bucket_refused_by_another_is_not_charged_for_it(clock: Clock) -> None:
    """All-or-nothing across the pair, which is what makes the Retry-After honest: the
    client is refused by the shared tier and told that tier's rate, so obeying the header
    must not quietly empty the per-address bucket the header said nothing about — coming
    back to a refusal from a tier it was never told about, for longer each time."""
    per_ip = RateLimiter(per_minute=60, burst=2)
    total = RateLimiter(per_minute=60, burst=1)
    take_all((per_ip, "1.2.3.4"), (total, "total"))

    for _ in range(10):
        take_expecting_429_from_all((per_ip, "1.2.3.4"), (total, "total"))

    assert per_ip._buckets["1.2.3.4"] == (1.0, 0.0)


def test_a_slower_per_key_tier_leaves_the_shared_one_to_other_keys(clock: Clock) -> None:
    """What per-address fairness comes to once the two bursts match, as create_app sizes
    them: the flooder empties both tiers at once, but by the time the shared bucket has
    earned a token back its own has not, so the token goes to whoever else asks."""
    per_key = RateLimiter(per_minute=10, burst=2)
    shared = RateLimiter(per_minute=30, burst=2)
    for _ in range(2):
        take_all((per_key, "1.2.3.4"), (shared, "total"))

    clock.now = 2.0  # a shared token every 2s, a key's own every 6s

    take_expecting_429_from_all((per_key, "1.2.3.4"), (shared, "total"))
    take_all((per_key, "5.6.7.8"), (shared, "total"))


def test_the_refusal_quotes_the_bucket_furthest_from_a_token(clock: Clock) -> None:
    """Both are empty and equally so, so the slower tier is the honest wait."""
    slow = RateLimiter(per_minute=30, burst=1)
    fast = RateLimiter(per_minute=60, burst=1)
    take_all((slow, "key"), (fast, "key"))

    refusal = take_expecting_429_from_all((slow, "key"), (fast, "key"))

    assert refusal.headers == {"Retry-After": "2"}


def test_the_furthest_bucket_is_quoted_even_when_another_is_refused_first(
    clock: Clock,
) -> None:
    """Ordering the tiers cannot promise this, which is why `take_all` does not rely on
    it: equal deficits rank by refill rate, but these deficits are not equal. The bucket
    listed first is empty and half a second from a token; the one behind it is empty and
    two and a half seconds away. Quoting the first would send a caller that obeyed the
    header back to a refusal from a tier it was never told about."""
    nearer = RateLimiter(per_minute=60, burst=1)  # a token a second
    further = RateLimiter(per_minute=20, burst=1)  # a token every three
    take_all((nearer, "key"), (further, "key"))

    clock.now = 0.5

    refusal = take_expecting_429_from_all((nearer, "key"), (further, "key"))

    assert refusal.headers == {"Retry-After": "3"}


def test_a_new_key_evicts_buckets_that_have_refilled_to_full(clock: Clock) -> None:
    """The memory bound, asserted on the private dict because size is the whole point:
    an attacker cycling addresses must leave behind only the keys still mid-refill."""
    limiter = RateLimiter(per_minute=60, burst=2)
    limiter.take("stale")
    clock.now = 2.0  # one token spent, refilled at 1/s — full again

    limiter.take("fresh")

    assert set(limiter._buckets) == {"fresh"}


def test_a_new_key_keeps_buckets_still_refilling(clock: Clock) -> None:
    """The other half of the eviction rule, and it has to outlast a prune to test it:
    `_tokens_at` only prunes once a refill interval has passed, so a bucket checked
    sooner survives by never being looked at. Both tokens go, putting "draining" two
    seconds from full — still mid-refill one second later, when the gate has elapsed and
    the new key really does trigger the scan."""
    limiter = RateLimiter(per_minute=60, burst=2)
    limiter.take("draining")
    limiter.take("draining")
    clock.now = 1.0  # a token's interval, so the prune runs — and finds it half refilled

    limiter.take("fresh")

    assert set(limiter._buckets) == {"draining", "fresh"}
