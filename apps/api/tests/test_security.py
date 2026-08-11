"""Unit tests for password hashing — no fixtures, no database.

The parameter assertions below are the point of this file. Argon2's cost and memory
figures are chosen for the deployment target in `security.py`, and nothing else would
notice them going back to the library defaults: hashing and verification would still
round-trip, so only a test naming the numbers catches it.
"""

import pytest
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError
from sqlalchemy import Text

from matchpoint_api.models import Coach
from matchpoint_api.security import DUMMY_HASH, hash_password, needs_rehash, verify_password

PASSWORD = "correct horse battery"

# The parameters security.py sets, as they appear in the hash string.
EXPECTED_PARAMETERS = "m=65536,t=3,p=1"

# A figure well clear of the ~100 characters Argon2 produces at these parameters, so that
# a later change lengthening the hash still fits.
MAX_HASH_LENGTH = 255


def test_hashing_the_same_password_twice_gives_different_hashes() -> None:
    """Each call salts afresh, which is what stops a stored hash being a lookup key: two
    coaches who picked the same password must not be visibly sharing it."""
    assert hash_password(PASSWORD) != hash_password(PASSWORD)


def test_the_hash_names_argon2id() -> None:
    """Argon2id, not Argon2i or Argon2d — the hybrid is what OWASP recommends for
    password storage, and the variant is recorded in the hash rather than configured on
    the way back in, so verification of existing rows follows whatever this says."""
    assert hash_password(PASSWORD).startswith("$argon2id$")


def test_the_hash_records_the_chosen_parameters() -> None:
    """The test that fails if the explicit parameters are ever tidied back to
    `PasswordHasher()`. `p` is the one that matters most: the default's four lanes are
    the same speed on a single core and only widen how much memory concurrent hashing
    can hold."""
    assert EXPECTED_PARAMETERS in hash_password(PASSWORD)


def test_the_column_storing_the_hash_cannot_truncate_it() -> None:
    """Asserted on the column, not only on the figure: a hash comfortably under 255
    characters says nothing about a `password_hash` later narrowed to one of the String
    widths the rest of the schema uses, and a truncated hash is a coach locked out of an
    account whose row looks perfectly healthy."""
    column_type = Coach.__table__.c.password_hash.type
    assert isinstance(column_type, Text)

    assert column_type.length is None
    assert len(hash_password(PASSWORD)) < MAX_HASH_LENGTH


def test_verifying_the_right_password_succeeds() -> None:
    assert verify_password(PASSWORD, hash_password(PASSWORD)) is True


def test_verifying_a_wrong_password_fails() -> None:
    assert verify_password("not the password", hash_password(PASSWORD)) is False


def test_verifying_is_case_sensitive() -> None:
    """Unlike the email, which the Coach model folds to lowercase — a near-miss that
    differs only in case is still the wrong password."""
    assert verify_password(PASSWORD.upper(), hash_password(PASSWORD)) is False


def test_the_same_password_verifies_across_two_encodings_of_it() -> None:
    """The lockout the normalisation in security.py exists to prevent: a coach enrols from
    a client submitting é as one code point and signs in from one submitting it as two.
    Nothing the coach typed differs, so neither may the answer here."""
    composed = "caf\u00e9 au lait"  # é as U+00E9
    decomposed = "cafe\u0301 au lait"  # e + U+0301 combining acute
    assert composed != decomposed

    assert verify_password(decomposed, hash_password(composed)) is True
    assert verify_password(composed, hash_password(decomposed)) is True


def test_the_dummy_hash_costs_what_a_real_one_costs() -> None:
    """DUMMY_HASH exists so an unknown email burns the same Argon2 work as a wrong
    password, and equal parameters are what make that time equal — verification cost
    is set by the parameters recorded in the hash string, not by the verifier."""
    assert DUMMY_HASH.startswith("$argon2id$")
    assert EXPECTED_PARAMETERS in DUMMY_HASH


def test_nothing_verifies_against_the_dummy_hash() -> None:
    """Its input is random and discarded at import, so no submitted password may ever
    come back True against it — login ignores the result, but only this keeps the
    ignored result from mattering."""
    assert verify_password(PASSWORD, DUMMY_HASH) is False
    assert verify_password("", DUMMY_HASH) is False


def test_a_current_hash_does_not_need_a_rehash() -> None:
    """The quiet branch of every successful login: parameters unchanged, nothing to
    do. If this fails, every login is re-hashing — twice the Argon2 work per sign-in
    for nothing."""
    assert needs_rehash(hash_password(PASSWORD)) is False


def test_a_hash_with_stale_parameters_needs_a_rehash() -> None:
    """How a future parameter change reaches stored rows: login asks, this answers.
    The stale hash is built with deliberately cheap parameters — what matters is only
    that they differ from security.py's."""
    stale = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(PASSWORD)

    assert needs_rehash(stale) is True


def test_verifying_against_a_stored_value_that_is_not_a_hash_raises() -> None:
    """Deliberately not False. A row whose password_hash is not an Argon2 hash is a bug
    in whatever wrote it, and answering "wrong password" would leave the coach locked out
    of an account nobody can see is broken."""
    with pytest.raises(InvalidHashError):
        verify_password(PASSWORD, "not-a-real-hash")
