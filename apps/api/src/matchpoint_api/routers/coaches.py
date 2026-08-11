import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from matchpoint_api.db import get_db
from matchpoint_api.models import Coach
from matchpoint_api.schemas.coach import CoachRead

router = APIRouter(prefix="/coaches", tags=["coaches"])

DbSession = Annotated[Session, Depends(get_db)]


# No create route yet — see #22 — and deliberately no list route to pair with the ones on
# players and matches: a coach roster is a list of email addresses, and nothing
# authenticates a request yet. Fetching one by id needs the coach's own unguessable
# UUID, and is what becomes GET /coaches/me once there is a caller to identify.
@router.get("/{coach_id}", response_model=CoachRead)
def get_coach(coach_id: uuid.UUID, db: DbSession) -> Coach:
    coach = db.get(Coach, coach_id)
    if coach is None:
        raise HTTPException(status_code=404, detail="Coach not found")
    return coach
