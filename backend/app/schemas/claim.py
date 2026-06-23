# Pydantic shapes for the claim endpoints.
#
# CreateClaimPayload carries the quantity the recipient wants.
# ClaimResponse is the shape returned after a successful create.

from datetime import datetime

from pydantic import BaseModel, Field


class CreateClaimPayload(BaseModel):
    quantity: int = Field(gt=0)


class ClaimResponse(BaseModel):
    id: str
    listing_id: str
    claimant_id: str
    requested_quantity: int
    status: str
    requested_at: datetime
