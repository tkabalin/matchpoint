"""Refusing a chosen password nothing else refuses, without leaving the process.

The schema's length bounds (`schemas/coach.py`) are bounds and not a policy, so
`12345678`, `aaaaaaaa` and a coach called Mike choosing `mike-mike` all satisfy them.
NIST SP 800-63B asks that a chosen password be compared against a list of values known
to be commonly used or expected, and names repetitive characters, sequential characters,
dictionary words and context-specific words (the service's name, the account's own name)
as what belongs on that list. The compromised half of it is a breach-list lookup over
the network (#140); everything here is arithmetic over the submitted string, so it costs
no request and has no failure mode of its own.

The same screens run zxcvbn in the browser (`apps/web/src/lib/password-strength.ts`),
which overlaps these rules without mirroring them: it scores guessability where this
names a rule, so a password its meter passes can still be refused here. That is why the
reason travels back as a plain sentence: it is advice a coach acts on, not a fact worth
withholding, and the coach may be seeing it for the first time at the 400.

The thresholds are deliberately loose, because the two kinds of mistake do not cost the
same. A false rejection lands on a coach mid-sign-up with no way around it, where a miss
falls through to the breach list and to zxcvbn's own scoring: `aaaabbbb` and
`passwordpassword` are bad passwords this module accepts, and that is the trade.
"""

import itertools
import re
from collections import Counter

from fastapi import HTTPException

from matchpoint_api.security import normalise

# Five is an absolute run rather than a fraction of the password, unlike the repetition
# rule below: a doubled letter is ordinary in a real word, while five consecutive code
# points are not something a phrase produces by accident.
SEQUENCE_LIMIT = 5

# Below four characters a coach's own word is a substring of half the passwords anyone
# would choose ("al" from an Al, "jo" from a jo@ address), so the rule would reject far
# more than it protects.
CONTEXT_MIN_LENGTH = 4

# One reason per category, in the words the form shows: the four are distinguished here
# rather than collapsed into "weak password" because a coach cannot act on the second.
REPEATED = "Password is mostly one repeated character"
SEQUENTIAL = "Password runs through consecutive characters"
COMMON = "Password is too common"
CONTEXT = "Password contains your name or email address"

# The description the OpenAPI spec carries for the 400, shared by the routes that raise
# it: one status covers all four reasons, and the body says which.
REJECTION = "Password rejected by policy"

# Matched whole rather than as substrings, which is what lets `a-good-password` through:
# a list of forbidden fragments would refuse most of the passphrases this app wants
# coaches to choose. Entries shorter than the schema's eight-character floor are still
# worth listing, since `_bare` below matches them against a stripped form. Nothing purely
# sequential is listed, since the sequence rule already has `12345678` and `abc12345`.
COMMON_PASSWORDS = frozenset(
    {
        "password",
        "passw0rd",
        "p@ssword",
        "p@ssw0rd",
        "qwerty",
        "qwertyui",
        "qwertyuiop",
        "asdfghjkl",
        "1qaz2wsx",
        "iloveyou",
        "trustno",
        "sunshine",
        "princess",
        "football",
        "baseball",
        "starwars",
        "superman",
        "letmein",
        "welcome",
        "monkey",
        "dragon",
        "shadow",
        "master",
        "admin",
        "changeme",
        "secret",
        "tennis",
        "matchpoint",
    }
)


def _bare(password: str) -> str:
    """The password with the digits and punctuation trailing it removed.

    The blocklist is matched against this as well as against the password itself:
    `password!` and `monkey123` are the same guess as `password` and `monkey`, and one
    trailing character is all the eight-character floor asks for. Only the tail goes,
    since stripping throughout would fold `a-good-password` onto a listed word.
    """
    return re.sub(r"[\d\W_]+$", "", password)


def _longest_sequence(password: str) -> int:
    """The longest stretch of adjacent code points, counting up or down.

    Code points, not keyboard positions: `abcdefgh` and `87654321` are what this
    catches, and a keyboard walk like `qwertyui` is the blocklist's job.
    """
    longest = 1
    for step in (1, -1):
        run = 1
        for previous, character in itertools.pairwise(password):
            run = run + 1 if ord(character) - ord(previous) == step else 1
            longest = max(longest, run)
    return longest


def _context_words(email: str, display_name: str) -> set[str]:
    """The coach's own words, as the substrings worth refusing.

    The email's local part and the pieces of it, so `mike.smith@` contributes `smith`
    as well; the display name's words, and the whole name joined up. The domain stays
    out: it names a mail provider far more often than a coach, and `gmail` inside a
    password gives away nothing about who chose it.
    """
    local_part = email.partition("@")[0]
    words = re.split(r"[\W_]+", display_name)
    candidates = {local_part, *re.split(r"[\W_]+", local_part), *words, "".join(words)}
    return {normalise(word).casefold() for word in candidates if len(word) >= CONTEXT_MIN_LENGTH}


def rejection_reason(password: str, *, email: str, display_name: str) -> str | None:
    """Why this password cannot be used, or None if it can.

    The first matching rule is the one reported, since a password failing two of them
    still only needs one thing said about it.
    """
    # Normalised first, so the string judged here is the string `security.py` will hash:
    # the fullwidth digits `１２３４５６７８` are `12345678` by the time they reach the
    # column, and a policy reading the bytes as submitted would have accepted them.
    folded = normalise(password).casefold()
    if folded in COMMON_PASSWORDS or _bare(folded) in COMMON_PASSWORDS:
        return COMMON
    # Counted rather than scanned for a run, so `a1a2a3a4a` is caught alongside
    # `aaaaaaaa`, and compared against half the length so that a doubled letter in an
    # ordinary word is left alone.
    if max(Counter(folded).values(), default=0) * 2 > len(folded):
        return REPEATED
    if _longest_sequence(folded) >= SEQUENCE_LIMIT:
        return SEQUENTIAL
    if any(word in folded for word in _context_words(email, display_name)):
        return CONTEXT
    return None


def check_password(password: str, *, email: str, display_name: str) -> None:
    """Raise the 400 that refuses a password this policy will not accept.

    A 400 rather than the 422 a rejected body usually answers, because FastAPI declares
    every route's 422 as a list of field errors and the generated client reads it as one
    (`errors.py`), so a sentence under `detail` there is a body the client cannot parse.
    """
    reason = rejection_reason(password, email=email, display_name=display_name)
    if reason is not None:
        raise HTTPException(status_code=400, detail=reason)
