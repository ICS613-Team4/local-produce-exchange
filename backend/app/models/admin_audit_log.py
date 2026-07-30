# A chronological record of admin moderation actions (US-35): who did what to
# whom, when, and why. This is the audit trail the admin activity report and
# its PDF export read from.
#
# admin_id is nullable. Every row written going forward always has a real
# admin_id, since the caller always has the acting admin in scope at the
# moment it writes the row. The one exception is historical data backfilled
# from suspension_record: that table never recorded WHO lifted a suspension
# (only WHEN, via lifted_at), so backfilled "member_unsuspended" rows have no
# actor to attribute.
#
# target_id is deliberately NOT a foreign key, unlike every other id column in
# this codebase. It points at a different table depending on target_type
# ("member", "listing", or "member_report"), so a single-table FK cannot
# describe it. Resolving a human-readable label for a row is the router's job
# (see list_audit_log in routers/admin_audit_log.py), not the database's.
#
# reason stays null for listing_deactivated, since deactivate_listing_as_admin
# takes no reason today. That is a property of that action, not a bug in this
# table.

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Index, text, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    admin_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    action: Mapped[str] = mapped_column(Text)
    target_type: Mapped[str] = mapped_column(Text)
    target_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )

    __table_args__ = (
        Index("ix_admin_audit_log_created_at", "created_at"),
        Index("ix_admin_audit_log_target", "target_type", "target_id"),
    )
