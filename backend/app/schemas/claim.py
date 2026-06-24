# Pydantic shapes for the claim endpoints.
#
# CreateClaimPayload carries the quantity the recipient wants.
# ClaimResponse is the shape returned after a successful create.
# The three request-queue shapes below (US-10) describe the poster's view of the
# pending requests on their listings: one pending row, one listing's group of
# rows, and the whole response.

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


# One pending request in a listing's queue (US-10). The poster sees who asked,
# how much they asked for, and when, so the rows can be shown oldest first.
class QueueClaimItem(BaseModel):
    id: str
    claimant_id: str
    claimant_name: str
    requested_quantity: int
    requested_at: datetime


# One listing's queue: the listing's own details plus its pending rows. The
# status lets the frontend label a deactivated listing, and remaining_quantity
# is shown next to the requests.
class ListingQueueGroup(BaseModel):
    listing_id: str
    listing_title: str
    listing_status: str
    remaining_quantity: int
    pending: list[QueueClaimItem]


# The whole response: one group per listing that has at least one pending
# request. An empty list means nothing is pending.
class RequestQueuesResponse(BaseModel):
    groups: list[ListingQueueGroup]
