import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, LargeBinary, Text, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ListingPhoto(Base):
    __tablename__ = "listing_photo"

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
    content_type: Mapped[str] = mapped_column(Text)
    image_bytes: Mapped[bytes] = mapped_column(LargeBinary)
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )

    __table_args__ = (Index("ix_listing_photo_listing_id", "listing_id"),)
