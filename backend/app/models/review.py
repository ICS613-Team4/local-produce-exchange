# The review model: one member's rating and written review of the other party
# on a completed exchange (US-20).
#
# The shape rules this table enforces:
#   - One review per (claim_id, reviewer_id), forever. The unique constraint
#     covers every row, live or disabled, ON PURPOSE: a review an admin
#     disabled still occupies the member's one slot for that exchange, so the
#     member cannot write a replacement. Do not "fix" the constraint into a
#     partial index that skips disabled rows; that would break the rule.
#   - reviewee_role records which reputation the review counts toward:
#     "listing_owner" (the reviewee owned the listing) or "requestor" (the
#     reviewee requested it). A member has two separate reputations and this
#     column keeps them apart with a one-column filter.
#   - disabled_at / disabled_by are set only by a future admin action. Null
#     means the review is live. A set disabled_at freezes the row: the author
#     may not edit it and may not write a new review for the exchange.

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    text,
    Text,
    TIMESTAMP,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Review(Base):
    __tablename__ = "review"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    # The completed exchange this review is about.
    claim_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("claim.id"),
    )
    # The member who wrote the review.
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    # The member the review is about (the other party on the exchange).
    reviewee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    # The role the reviewee played in this exchange: "listing_owner" or
    # "requestor". Set by the server from the claim, never from the request.
    reviewee_role: Mapped[str] = mapped_column(Text)
    # A whole number from 1 to 5.
    rating: Mapped[int] = mapped_column(Integer)
    # The written review. An empty string means a rating-only review.
    body: Mapped[str] = mapped_column(Text, server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )
    # Equal to created_at on a brand-new review; the edit endpoint moves it.
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )
    # Null means the review is live. A timestamp means an admin disabled it.
    disabled_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    # The admin who disabled it, for an audit trail. Null while live.
    disabled_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )

    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_review_rating_range"),
        CheckConstraint(
            "reviewee_role IN ('listing_owner', 'requestor')",
            name="ck_review_reviewee_role",
        ),
        # One review per reviewer per exchange, permanently. No WHERE clause,
        # so disabled rows keep counting (see the note at the top of the file).
        UniqueConstraint("claim_id", "reviewer_id", name="uq_review_claim_reviewer"),
    )
