from typing import Annotated

from pydantic import StringConstraints

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
"""A free-text field, bounded to match the String(100) columns on the models.

Stripped before the length check, so whitespace-only input is rejected rather than
stored as a name that renders blank everywhere. Optional fields pair it with `| None`,
which leaves the bounds applying only to a value that is actually present.
"""

LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
"""A free-text field for prose, over an unbounded Text column.

The bound is the schema's alone — the column has none. It exists to reach the OpenAPI
spec, so the client form can enforce it, and to keep a runaway paste out of the
database; the exact figure is room for a page of notes, not a measured limit.

Blank is rejected on the same reasoning as ShortText. Where the field is optional that
means omitting it or sending null, never "".
"""
