from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.listing import ListingPhotoRef

MESSAGE_MAX_LENGTH = 2000


class SendMessagePayload(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)


class MessageResponse(BaseModel):
    id: str
    thread_id: str
    sender_id: str
    sender_name: str
    body: str
    sent_at: datetime


class ThreadResponse(BaseModel):
    id: str
    claim_id: str
    created_at: datetime
    messages: list[MessageResponse]
    # The listing the exchange is about, so the page can show what is being
    # exchanged without another fetch: the title (linked by id), who posted it
    # and when, the pickup window, and the claim's requested and approved
    # quantities. The photos list is the same shape as ListingResponse.photos.
    # Defaults keep older construction sites and stubs working.
    listing_id: str = ""
    listing_title: str = ""
    # The two parties' ids, so the page can tell whether the viewer is the
    # poster (owner) or the requester (claimant) and tailor its wording.
    owner_id: str = ""
    claimant_id: str = ""
    owner_name: str = ""
    claimant_name: str = ""
    listing_created_at: Optional[datetime] = None
    pickup_start: Optional[datetime] = None
    pickup_end: Optional[datetime] = None
    requested_quantity: Optional[int] = None
    approved_quantity: Optional[int] = None
    photos: list[ListingPhotoRef] = Field(default_factory=list)
