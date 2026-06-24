# Pydantic shapes for the claim endpoints.
#
# CreateClaimPayload carries the quantity the recipient wants.
# ClaimResponse is the shape returned by create, approve, deny, and withdraw.
# The three request-queue shapes below (US-10) describe the poster's view of the
# pending requests on their listings: one pending row, one listing's group of
# rows, and the whole response.

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# The largest value a 32-bit signed integer can hold. The requested_quantity
# column is a PostgreSQL Integer, so a request above this would overflow that
# column. Bounding the field rejects such a value with a clear 422 at validation,
# before it ever reaches the database.
POSTGRES_INTEGER_MAX = 2147483647


class CreateClaimPayload(BaseModel):
    quantity: int = Field(gt=0, le=POSTGRES_INTEGER_MAX)


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
    cancelled_at: Optional[datetime] = None


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


# One of the caller's own requests, for the "my requests" page. It carries the
# listing it was made on, the quantity asked for, and (once decided) the approved
# quantity and the time it was approved or denied, so the page can show it in the
# right section with the right timestamp.
class MyRequestItem(BaseModel):
    id: str
    listing_id: str
    listing_title: str
    requested_quantity: int
    approved_quantity: Optional[int] = None
    status: str
    requested_at: datetime
    approved_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None


# The "my requests" response, split into the three sections the page shows. Each
# list is newest-first with a stable id tiebreaker. An empty list means that
# section has nothing.
class MyRequestsResponse(BaseModel):
    pending: list[MyRequestItem]
    approved: list[MyRequestItem]
    denied: list[MyRequestItem]
