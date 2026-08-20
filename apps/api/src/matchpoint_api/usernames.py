"""Generated player usernames, the identifier a player signs in with.

A player has no email, so their login identifier is minted by the server when the
coach creates them: three letters of the surname, three of the first name, and a
number from 001 telling namesakes apart: kbltho001, the student-number shape the
issue decided on. The coach reads it off the create response and hands it over with
the one-time password.
"""

import re
import unicodedata

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from matchpoint_api.models import Player

_VOWELS = frozenset("aeiou")


def _letters(name: str) -> str:
    """A name folded to bare a-z: NFKD splits a letter from its accent so Müller keeps
    its m-u-l, casefold rather than lower for the one-to-many cases (ß to ss), and
    everything else (punctuation, spaces, digits, scripts with no Latin letters)
    simply drops out."""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z]", "", stripped.casefold())


def _pad(part: str) -> str:
    """Padded to exactly three, so the prefix stays fixed-width even for a two-letter
    name and the numeric suffix always starts at the seventh character."""
    return (part + "xxx")[:3]


def username_prefix(first_name: str, last_name: str) -> str:
    """The six-letter head of a username: surname letters first, as the pattern reads.

    The surname part keeps its first letter and then prefers consonants, the vowels it
    skipped filling in only when the consonants run short: Kabalin folds to kbl, Lee
    stays lee. The first-name part is the plain first three letters. Both rules are the
    student-number scheme's, per the examples the issue's decision points at.
    """
    surname = _letters(last_name)
    if surname:
        consonants = "".join(char for char in surname[1:] if char not in _VOWELS)
        vowels = "".join(char for char in surname[1:] if char in _VOWELS)
        surname = surname[0] + consonants + vowels
    return _pad(surname) + _pad(_letters(first_name))


def next_username(db: Session, first_name: str, last_name: str) -> str:
    """The next free username for this name, numbering namesakes from 001.

    Reads the highest number already minted under the prefix rather than counting
    rows, so a deleted namesake never makes a number come around twice. The regex is
    belt-and-braces, since every username is six letters then digits and the prefix
    match alone would do, and is safe to interpolate because _letters leaves only a-z.
    """
    prefix = username_prefix(first_name, last_name)
    taken = db.scalar(
        select(func.max(cast(func.substr(Player.username, 7), Integer))).where(
            Player.username.regexp_match(f"^{prefix}[0-9]+$")
        )
    )
    # Past 999 the format widens on its own: 03d is a floor, not a ceiling.
    return f"{prefix}{(taken or 0) + 1:03d}"
