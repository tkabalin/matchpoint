import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


# Comments rather than a docstring: a schema's docstring becomes its description in the
# OpenAPI spec and a TSDoc comment on the generated client type, and neither of the notes
# below is anything an API consumer needs.
#
# There is no CoachCreate alongside this one. Creating a coach means turning a password
# into a hash, and how that happens is left to the sign-up work (#22) rather than settled
# here as a side effect of the model.
#
# password_hash is absent, and belongs nowhere else either. `response_model` filters a
# response down to the fields declared here, so this omission is what keeps the hash from
# following a Coach row out of any route that returns one.
class CoachRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    created_at: datetime
    updated_at: datetime
