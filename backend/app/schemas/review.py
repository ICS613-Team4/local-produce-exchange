# Pydantic shapes for the review endpoints (US-20).
#
# CreateReviewPayload carries the rating and the optional written review.
# EditReviewPayload is the same shape for the edit endpoint; it is a separate
# class so the two request shapes can diverge later without entangling them.
# ReviewResponse is one saved review, returned by the create and edit endpoints
# and embedded in the context response.
# ReviewContextResponse is everything the review screen needs to render, for
# either side of the exchange.

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

# The longest written review the form accepts, in characters.
REVIEW_BODY_MAX_LENGTH = 1000


class CreateReviewPayload(BaseModel):
    # A whole number from 1 to 5. Pydantic rejects anything outside with a 422.
    rating: int = Field(ge=1, le=5)
    # Optional; the default empty string is a rating-only review.
    body: str = Field(default="", max_length=REVIEW_BODY_MAX_LENGTH)


class EditReviewPayload(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str = Field(default="", max_length=REVIEW_BODY_MAX_LENGTH)


class ReviewResponse(BaseModel):
    id: str
    claim_id: str
    reviewer_id: str
    reviewee_id: str
    # "listing_owner" or "requestor": the role the reviewee played.
    reviewee_role: str
    rating: int
    body: str
    created_at: datetime
    updated_at: datetime
    # True when an admin disabled this review. The raw disabled_at and
    # disabled_by audit columns are not exposed; this one boolean is what the
    # screen and US-21 read.
    is_disabled: bool


class ReviewContextResponse(BaseModel):
    claim_id: str
    listing_id: str
    listing_title: str
    # "listing_owner" or "requestor": the ACTING member's role on this
    # exchange. The reviewee's role is always the other one.
    role: str
    other_party_id: str
    other_party_name: str
    completed_at: datetime
    already_reviewed: bool
    existing_review: Optional[ReviewResponse] = None
    # True only when the acting member has a review for this exchange AND it
    # is not disabled. The screen reads this one flag to choose between the
    # edit form and the frozen read-only panel.
    can_edit: bool
