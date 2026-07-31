# A member's report of another member for admin attention (US-37). Filing a
# report never changes the target's status by itself; it only queues
# something for an admin to review and resolve.
#
# One open report per (reporter, target) at a time: the partial unique index
# below blocks a second report from the same reporter against the same
# target while an earlier one from them is still open. Once that one is
# resolved, they can file again.
#
# category is a fixed, short list enforced by the router (see
# MEMBER_REPORT_CATEGORIES in routers/member_report.py), not a database enum,
# so the list can grow without a migration - the same choice notification.kind
# makes. status is a genuinely closed two-value set, so it does get a
# CheckConstraint, matching review.reviewee_role.

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, ForeignKey, Index, text, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MemberReport(Base):
    __tablename__ = "member_report"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    # The member who filed the report.
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    # The member being reported.
    target_member_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    category: Mapped[str] = mapped_column(Text)
    # Optional additional detail from the reporter.
    detail: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'open'"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )
    # Null while open. Set together with resolved_by/resolution_note when an
    # admin resolves the report.
    resolved_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    resolved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    resolution_note: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("status IN ('open', 'resolved')", name="ck_member_report_status"),
        Index(
            "uq_member_report_one_open",
            "reporter_id",
            "target_member_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
        Index("ix_member_report_target_status", "target_member_id", "status"),
    )
