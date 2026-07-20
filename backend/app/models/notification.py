import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Index, Text, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    # The member who should SEE this notification (the recipient).
    member_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    # The related exchange, so the member can open it. Nullable so a future
    # notification that is not tied to one claim is still a normal row.
    claim_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("claim.id"),
    )
    # A short machine label for the event, stored as plain text (not an enum) so
    # new kinds can be added with no migration. Known values:
    #   request_submitted, request_approved, request_denied, request_withdrawn,
    #   request_cancelled (US-13), pickup_confirmed (US-18),
    #   exchange_completed (US-19), message_received (exchange thread message)
    kind: Mapped[str] = mapped_column(Text)
    # The human-readable line shown to the member.
    message: Mapped[str] = mapped_column(Text)
    # False until the member marks it read (US-23). The database fills this.
    is_read: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )
    # Set when the member marks it read (US-23). Null until then.
    read_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))

    __table_args__ = (
        # The newest-first read filters by member_id and sorts by created_at, so
        # one index on both columns serves that query.
        Index("ix_notification_member_created", "member_id", "created_at"),
        # The header bell polls the unread count every 15 seconds, so that count
        # is the most-run query in the whole story. This partial index covers it
        # exactly: it indexes ONLY the unread rows, so the count is answered by
        # reading a small index instead of scanning the member's whole history.
        # It also shrinks over time once US-23 starts marking rows read, because
        # a row marked read drops out of the index.
        Index(
            "ix_notification_member_unread",
            "member_id",
            postgresql_where=text("is_read = false"),
        ),
    )
