"""Unit tests for the breach-corpus seam — no fixtures, no database, no network.

The route-level proof that create_app wires the seam lives in `tests/routers/`; these
cover the module's own promises, the first of which is that the password never leaves.

`PwnedPasswordsChecker` is exercised through a `MockTransport`, so the real path runs —
hash taken, prefix split off, answer parsed — with nothing leaving the process. The
endpoint is free and unmetered, so this is not about quota: it is that a test suite
asking a third party about `password` on every run is a test suite that fails when
someone's wifi does.

`password` is the vector throughout, because its SHA-1 is the one every Pwned Passwords
example in the wild uses: 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
"""

import hashlib
import logging
from collections.abc import Callable

import httpx
import pytest

from matchpoint_api.breach import (
    PWNED_RANGE_URL,
    AllowAllBreachChecker,
    BreachCheckError,
    PwnedPasswordsChecker,
    create_breach_checker,
)
from matchpoint_api.config import Settings, settings

Handler = Callable[[httpx.Request], httpx.Response]

PASSWORD = "password"
PREFIX = "5BAA6"
SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"


def _checker_answering(handler: Handler) -> PwnedPasswordsChecker:
    """A checker whose transport is the given handler, so no request leaves the process."""
    return PwnedPasswordsChecker(client=httpx.Client(transport=httpx.MockTransport(handler)))


def _rows(*rows: str) -> Handler:
    """An answer made of the given `SUFFIX:COUNT` rows, as the API returns them."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="\r\n".join(rows))

    return handler


def test_the_vector_is_the_hash_the_api_would_be_asked_for() -> None:
    """Pins the split the whole module rests on, so a wrong PREFIX below cannot make the
    rest of this file agree with itself while testing the wrong bucket."""
    assert hashlib.sha1(PASSWORD.encode()).hexdigest().upper() == PREFIX + SUFFIX


def test_the_default_checker_is_the_real_one() -> None:
    """The opposite default to the email seam, and the reason is the absence of a key:
    nothing would catch a deployment that never configured this, so it is on unless
    someone turns it off.

    Read off the field rather than the live `settings`, which `tests/__init__.py` has
    already overridden — the question here is what someone with no .env at all gets.
    """
    assert Settings.model_fields["breach_checker"].default == "pwned"


def test_the_suite_runs_with_the_corpus_switched_off() -> None:
    """The invariant `tests/__init__.py` exists for: whatever the field default says, a
    test run does not ask a third party about the passwords it makes up."""
    assert isinstance(create_breach_checker(), AllowAllBreachChecker)


def test_the_setting_selects_the_real_checker(monkeypatch: pytest.MonkeyPatch) -> None:
    """What production relies on. monkeypatch rather than assignment because `settings` is
    shared for the session, and this suite's pin must survive the test."""
    monkeypatch.setattr(settings, "breach_checker", "pwned")

    assert isinstance(create_breach_checker(), PwnedPasswordsChecker)


def test_the_offline_checker_refuses_nothing() -> None:
    """It has nothing to answer from, so it must not pretend the corpus was consulted."""
    assert AllowAllBreachChecker().is_breached(PASSWORD) is False


def test_only_the_hash_prefix_is_sent() -> None:
    """The k-anonymity promise `docs/security.md` makes, as an assertion: five hex
    characters of the hash go, and the password and the rest of its hash stay here.

    The URL is pinned whole, which is what proves the path carries the prefix and nothing
    else. Headers and body are then checked separately, since either could carry the
    password just as far.
    """
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _rows(f"{SUFFIX}:2")(request)

    _checker_answering(handler).is_breached(PASSWORD)

    request = seen[0]
    assert str(request.url) == f"{PWNED_RANGE_URL}/{PREFIX}"
    # Host excluded because the corpus's own hostname contains the vector as a substring.
    carried = "".join(value for name, value in request.headers.items() if name != "host")
    assert SUFFIX not in carried
    assert PASSWORD not in carried
    assert request.content == b""


def test_the_answer_is_padded() -> None:
    """Without this header the number of rows in the answer narrows down which bucket was
    asked for, which is the one thing the prefix was chosen to keep vague."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _rows(f"{SUFFIX}:2")(request)

    _checker_answering(handler).is_breached(PASSWORD)

    assert seen[0].headers["Add-Padding"] == "true"


def test_a_listed_password_is_breached() -> None:
    checker = _checker_answering(_rows("0000000000000000000000000000000000A:9", f"{SUFFIX}:2"))

    assert checker.is_breached(PASSWORD) is True


def test_a_password_the_bucket_does_not_hold_is_not_breached() -> None:
    checker = _checker_answering(_rows("0000000000000000000000000000000000A:9"))

    assert checker.is_breached(PASSWORD) is False


def test_a_padding_row_is_not_a_sighting() -> None:
    """The bug a substring search of the answer would have: padding arrives as rows at
    count 0, so `SUFFIX in body` would refuse a password the corpus has never seen."""
    checker = _checker_answering(_rows(f"{SUFFIX}:0"))

    assert checker.is_breached(PASSWORD) is False


def test_an_answer_of_nothing_but_padding_is_not_a_sighting() -> None:
    checker = _checker_answering(_rows("0000000000000000000000000000000000A:0", f"{SUFFIX}:0"))

    assert checker.is_breached(PASSWORD) is False


def test_the_suffix_comparison_ignores_case() -> None:
    """The docs call the prefix case-insensitive and return uppercase suffixes; a checker
    that only matched uppercase would silently stop refusing anything if that changed."""
    checker = _checker_answering(_rows(f"{SUFFIX.lower()}:2"))

    assert checker.is_breached(PASSWORD) is True


def test_junk_lines_beside_real_rows_are_skipped() -> None:
    """Blank lines, a row with no count, and a count that isn't a number are not evidence,
    and must not raise, as long as the answer is otherwise a bucket of real rows."""
    checker = _checker_answering(
        _rows("", f"{SUFFIX}", f"{SUFFIX}:many", "   ", "0000000000000000000000000000000000A:9")
    )

    assert checker.is_breached(PASSWORD) is False


def test_a_200_that_is_not_corpus_rows_says_the_corpus_went_unasked() -> None:
    """An intercepting proxy's page, or a change of response format. Finding no rows would
    otherwise read as 'not breached' and turn the check into a no-op that logs nothing;
    this way the password still goes through, but something says so."""
    checker = _checker_answering(_rows("<html>Sign in to the guest wifi</html>"))

    with pytest.raises(BreachCheckError):
        checker.is_breached(PASSWORD)


@pytest.mark.parametrize("status", [429, 500, 503])
def test_a_refused_lookup_says_the_corpus_went_unasked(status: int) -> None:
    """Including the 429 the mail seam retries: here a failure already falls through to
    allowing the password, so a retry only holds the worker thread twice as long."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status)

    with pytest.raises(BreachCheckError):
        _checker_answering(handler).is_breached(PASSWORD)

    assert len(seen) == 1


def test_a_lookup_that_never_answers_says_the_corpus_went_unasked() -> None:
    """The failure PWNED_TIMEOUT exists to produce, and the one fail-open is really for."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("too slow", request=request)

    with pytest.raises(BreachCheckError):
        _checker_answering(handler).is_breached(PASSWORD)


def test_a_failed_lookup_logs_the_status_and_nothing_of_the_password(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The status is what diagnoses an outage; httpx's own message would add the URL, and
    so the prefix, for nothing. Read off this logger's records rather than caplog.text,
    which also holds httpx's request line — see `docs/security.md` on what that line
    means for the prefix.
    """
    with (
        caplog.at_level(logging.DEBUG, logger="matchpoint_api.breach"),
        pytest.raises(BreachCheckError),
    ):
        _checker_answering(lambda request: httpx.Response(500)).is_breached(PASSWORD)

    ours = [r.getMessage() for r in caplog.records if r.name == "matchpoint_api.breach"]
    assert ours == ["pwned passwords lookup failed: 500"]
    assert PREFIX not in ours[0]
