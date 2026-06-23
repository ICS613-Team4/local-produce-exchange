# The claim model: A request to take some quantity of a listing. Drives the claim state machine. 
#
# The claim_status enum values are:
#   requested  — newly submitted, waiting for the poster to act
#   approved   — poster has approved the claim
#   picked_up  — claimant has picked up the item
#   completed  — exchange is finished
#   cancelled  — claimant withdrew the claim
#   denied     — poster denied the claim

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    CheckConstraint,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    text,
    TIMESTAMP,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.listing import Listing  # noqa: F811
    from app.models.member import Member  # noqa: F811


class Claim(Base):
    __tablename__ = "claim"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("listing.id"),
    )
    claimant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    requested_quantity: Mapped[int] = mapped_column(Integer)
    # Set when the poster approves. Nullable until then.
    approved_quantity: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(
        SAEnum(
            "requested", "approved", "picked_up", "completed", "cancelled", "denied",
            name="claim_status",
            create_type=False,
        ),
        server_default="requested",
    )
    # Queue ordering: the time the claim was submitted.
    requested_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    picked_up_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    denied_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))

    __table_args__ = (
        CheckConstraint("requested_quantity > 0", name="ck_claim_requested_quantity_positive"),
        CheckConstraint("approved_quantity > 0", name="ck_claim_approved_quantity_positive"),
        # Only one open claim per member per listing. Once a claim moves to a
        # terminal status the member can submit a new one.
        Index(
            "uq_claim_one_open",
            "listing_id",
            "claimant_id",
            unique=True,
            postgresql_where=text("status = 'requested'"),
        ),
    )

    listing: Mapped["Listing"] = relationship(foreign_keys="[Claim.listing_id]")  # noqa: F821
    claimant: Mapped["Member"] = relationship(foreign_keys="[Claim.claimant_id]")  # noqa: F821
