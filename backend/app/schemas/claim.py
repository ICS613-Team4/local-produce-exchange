# Pydantic shapes for the claim endpoints.
#
# CreateClaimPayload carries the quantity the recipient wants.
# ClaimResponse is the shape returned by create, approve, and deny.

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class CreateClaimPayload(BaseModel):
    quantity: int = Field(gt=0)


class ClaimResponse(BaseModel):
    id: str
    listing_id: str
    claimant_id: str
    requested_quantity: int
    approved_quantity: Optional[int] = None
    status: str
    requested_at: datetime
    approved_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None
