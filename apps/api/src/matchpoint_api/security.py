"""Password hashing, with Argon2id parameters chosen for the deployment target.

`memory_cost` is allocated per concurrent hash, and routes that touch the database are
declared `def`, so they run on Starlette's anyio threadpool — 40 threads by default.
The per-hash figure therefore multiplies, and the budget it multiplies against is the
api container's `mem_limit` in `infra/prod/compose.yml`, not the total RAM of the VPS
`docs/infrastructure.md` records. That distinction decides the failure: overshooting a
cgroup limit is an OOM kill rather than a slow swap, and the container is
`restart: unless-stopped`, so a kill under load is a restart loop.

One core is what makes the answer cheap. Extra Argon2 lanes cannot run in parallel on it,
so `parallelism=1` rather than the library default of 4 — pinned to one core the two take
the same time, and four lanes are simply a claim about hardware we do not have. Concurrent
hashing was never available here, so bounding it to two at a time gives up no throughput
the box could have delivered, and buys back the budget to keep RFC 9106's 64 MiB instead
of trading memory away for iterations.

Changing these parameters later reaches rows already stored only via
`check_needs_rehash()` on a successful login, which is the one moment the plaintext and a
database session are both in hand. Nothing in this module does database work.
"""

import threading
import unicodedata

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

# One module-level instance: PasswordHasher is stateless and thread-safe, and the
# instance *is* the parameter set, so building one per request invites the parameters
# drifting between call sites.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)

# Two at a time, so the memory this module can hold is bounded at 2 x 64 MiB rather than
# the threadpool's 40 x 64 MiB — 128 MiB inside the container's 512, against 2.5 GiB
# outside it. A request waiting here holds its worker thread, which on one core it would
# have spent waiting for the core anyway; capping the arrival rate is rate limiting's job,
# not this module's.
_slots = threading.Semaphore(2)


def _normalise(password: str) -> str:
    """Fold a password to one canonical encoding before it is hashed or checked.

    A composable character has more than one valid encoding — é is either one code point
    or two — and which one arrives is decided by the client's platform and input method,
    not by what the coach typed. Hashing the bytes as submitted would lock out a coach who
    enrolled from a keyboard producing one form and signs in from one producing the other,
    with nothing to say why: the same silent-lockout failure `verify_password` is careful
    to avoid below. NIST SP 800-63B calls for NFKC or NFKD; either serves, so long as both
    functions here apply the same one.
    """
    return unicodedata.normalize("NFKC", password)


def hash_password(password: str) -> str:
    """Hash a password for storage, with a fresh salt per call.

    Two calls on one password therefore differ, so a stored hash is not a lookup key.
    """
    with _slots:
        return _hasher.hash(_normalise(password))


def verify_password(password: str, password_hash: str) -> bool:
    """Check a password against a stored hash, returning False if it does not match.

    An `InvalidHashError` from a stored value that is not an Argon2 hash at all is
    deliberately left to propagate. That is a data-integrity bug rather than a failed
    sign-in, and reporting it as a wrong password would leave a coach permanently unable
    to log in with nothing saying why.
    """
    with _slots:
        try:
            return _hasher.verify(password_hash, _normalise(password))
        except VerifyMismatchError:
            return False
