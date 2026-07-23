# Pydantic shapes for the claim endpoints.
#
# CreateClaimPayload carries the quantity the recipient wants.
# ClaimResponse is returned by the create and claim-status update endpoints.
# The three request-queue shapes below (US-10) describe the poster's view of the
# pending requests on their listings: one pending row, one listing's group of
# rows, and the whole response.

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.listing import ListingPhotoRef


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
    picked_up_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None


# One pending request in a listing's queue (US-10). The poster sees who asked,
# how much they asked for, and when, so the rows can be shown oldest first.
# can_decide and can_deny are the backend-computed display rules (US-24). They are
# split because denying needs no remaining quantity while approving does, so an
# owner can still deny a pending request on a listing that is fully allocated.
# can_decide is true only when the request can still be approved right now;
# can_deny is true only when it can still be denied. The decide endpoints still run
# their own checks after a click; these only decide whether to show the buttons.
class QueueClaimItem(BaseModel):
    id: str
    claimant_id: str
    claimant_name: str
    requested_quantity: int
    requested_at: datetime
    can_decide: bool
    can_deny: bool
    # The requestor's reputation AS a requestor (US-20): the average rating
    # and review count across reviews where this member was reviewed in the
    # requestor role, excluding disabled reviews. Shown next to Approve and
    # Deny so the owner can weigh whose request to accept. None with a 0
    # count means no requestor reviews yet. The defaults keep older
    # construction sites working.
    claimant_requestor_average: Optional[float] = None
    claimant_requestor_count: int = 0


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
    # The listing's own status ("active", "deactivated", and so on). The page
    # uses it to decide whether the title links to the listing: only an active
    # listing has a page to show, so only an active one is linked. The default
    # keeps older construction sites working.
    listing_status: str = "active"
    owner_name: str
    requested_quantity: int
    approved_quantity: Optional[int] = None
    status: str
    requested_at: datetime
    approved_at: Optional[datetime] = None
    picked_up_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    # The requested listing's photos, ordered for display, so the page can show
    # the listing's cover photo next to the request. Same shape as
    # ListingResponse.photos; the default keeps older construction sites working.
    photos: list[ListingPhotoRef] = Field(default_factory=list)
    # True when the caller already left a review on this exchange (US-20), so a
    # completed row can offer "Edit Your Review" instead of "Leave a Review".
    # The default keeps older construction sites working.
    reviewed_by_me: bool = False


# The "my requests" response, split into the five sections the page shows. Each
# list is newest-first with a stable id tiebreaker. An empty list means that
# section has nothing.
class MyRequestsResponse(BaseModel):
    pending: list[MyRequestItem]
    approved: list[MyRequestItem]
    completed: list[MyRequestItem]
    denied: list[MyRequestItem]
    withdrawn: list[MyRequestItem]


# One request in the poster's full per-listing history (US-24). Unlike
# QueueClaimItem, this carries the request's status and its decision timestamps,
# because this view shows every status, not just pending. can_decide and can_deny
# are the same display rules as on QueueClaimItem: can_decide is true only when
# approve should be offered, can_deny only when deny should be offered.
class AllRequestItem(BaseModel):
    id: str
    claimant_id: str
    claimant_name: str
    requested_quantity: int
    approved_quantity: Optional[int] = None
    status: str
    requested_at: datetime
    approved_at: Optional[datetime] = None
    picked_up_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    can_decide: bool
    can_deny: bool
    # True when the caller already left a review on this exchange (US-20), so a
    # completed row can offer "Edit Your Review" instead of "Leave a Review".
    # The default keeps older construction sites working.
    reviewed_by_me: bool = False
    # The requestor's reputation AS a requestor (US-20), same meaning and
    # defaults as on QueueClaimItem, so the requests page can show it next to
    # Approve and Deny.
    claimant_requestor_average: Optional[float] = None
    claimant_requestor_count: int = 0


# One listing's full request history: the listing's title and remaining
# quantity, plus every request on it (any status), oldest first. The requests
# list is empty when an active listing has no requests yet. listing_status is
# "active" or "deactivated" so the page can mark a deactivated listing that
# still has exchanges in flight; the default keeps older construction sites
# working.
class ListingAllRequestsGroup(BaseModel):
    listing_id: str
    listing_title: str
    listing_status: str = "active"
    remaining_quantity: int
    requests: list[AllRequestItem]
    # When the listing was posted, so the page can show it under the title.
    # Optional with a None default so older construction sites keep working.
    created_at: Optional[datetime] = None
    # The listing's photos, ordered for display, so the page can show the
    # listing's cover photo on its group. Same shape as ListingResponse.photos.
    photos: list[ListingPhotoRef] = Field(default_factory=list)


# The whole all-requests response (US-24): one group per active listing the
# caller owns, including listings with no requests. An empty list means the
# caller has no active listings.
class AllRequestsResponse(BaseModel):
    groups: list[ListingAllRequestsGroup]
