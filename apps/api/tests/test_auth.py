"""Unit tests for the session-token helpers — no fixtures, no database.

The resolving dependency and the routes that use these are exercised through the
client in tests/routers/; what is pinned here is the shape of the credential itself.
"""

import re

from matchpoint_api.auth import (
    SESSION_LIFETIME,
    hash_token,
    new_player_password,
    new_session_token,
)


def test_each_token_is_fresh() -> None:
    """Every login mints its own credential: two logins must never share one, or a
    logout would sign out a session it was never aimed at."""
    assert new_session_token() != new_session_token()


def test_a_token_is_long_enough_to_be_unguessable() -> None:
    """32 bytes before encoding — 256 bits. The token is the whole proof of identity,
    so its entropy is the security parameter; anything shorter is a change someone
    must make on purpose."""
    assert len(new_session_token()) >= 43  # 32 bytes, base64url: ceil(32 * 4 / 3)


def test_hashing_a_token_is_deterministic() -> None:
    """The opposite requirement to password hashing, which salts: the stored hash is
    the lookup key for the presented token, so equal tokens must hash equal."""
    token = new_session_token()
    assert hash_token(token) == hash_token(token)


def test_the_hash_is_not_the_token_and_fits_the_column() -> None:
    """64 hex characters — exactly the String(64) the column declares, and nothing
    like the token itself, which is the value the table must never contain."""
    token = new_session_token()
    digest = hash_token(token)

    assert digest != token
    assert len(digest) == 64
    assert set(digest) <= set("0123456789abcdef")


def test_each_player_password_is_fresh() -> None:
    assert new_player_password() != new_player_password()


def test_a_player_password_reads_aloud_without_ambiguity() -> None:
    """Three groups of four from a 32-symbol alphabet: sixty bits, and no l, o, 0 or 1,
    because the coach hands this over read aloud or copied onto paper. A change to the
    shape is a change to how every new player receives their first credential."""
    password = new_player_password()

    assert re.fullmatch(r"[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}", password)
    assert not set(password) & set("lo01")


def test_the_lifetime_is_long_lived() -> None:
    """Offline-first: capture has to survive a match with no connection, so the
    credential is long-lived on purpose and revocation is what bounds the risk. A
    figure under a week would be a different design, not a tweak."""
    assert SESSION_LIFETIME.days >= 7
