from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, StringConstraints


# Base for every request-body schema. extra="forbid" turns an unknown key into a 422:
# the client is generated from this API's own spec, so a key we don't recognise is a
# bug in the caller, and ignoring it makes a misspelled field look like success.
class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


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


# Default for XUpdate fields over non-nullable columns: the field becomes optional to
# send while null stays rejected, since the annotation keeps its non-optional type.
# Typed Any for pyright; never validated (defaults aren't) nor dumped (exclude_unset).
UNSET: Any = None
