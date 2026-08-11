from pydantic import BaseModel


# The body an HTTPException produces, declared as a model so that a route's non-2xx
# responses reach the OpenAPI spec with a shape rather than only a description.
#
# A `responses` entry carrying no model generates `409: unknown` in the TypeScript client,
# and because the client unions a route's error responses together, one `unknown` member
# swallows the union whole — taking the auto-declared 422 down with it and leaving the
# caller unable to read `detail` off either. Declaring the status is what lets a form
# branch on it, so declaring one without a model defeats the reason for declaring it.
class ErrorDetail(BaseModel):
    detail: str
