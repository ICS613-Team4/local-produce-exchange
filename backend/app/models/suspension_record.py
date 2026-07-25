# Audit history of admin suspend/unsuspend actions on a member (US-25/US-26).
#
# One row per suspension episode: created when an admin suspends the member,
# closed (lifted_at set) when an admin reinstates them. lifted_at staying null
# is what "currently suspended" means in this table; member.status is the
# fast, indexed source of truth the rest of the app checks, this table is the
# history behind it.
#
# Kept plain on purpose (who, whom, when, why) so a later admin activity log
# spanning other moderation actions (for example listing deactivation) can
# read this table the same way it reads theirs, without a rework here.

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, text, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SuspensionRecord(Base):
    __tablename__ = "suspension_record"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    # The member who was suspended.
    member_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    # The admin who suspended them. Reinstating does not change this column;
    # it names who opened the suspension episode, not who closed it.
    admin_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    # Optional, admin-entered, why this member was suspended.
    reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )
    # Null means this suspension episode is still open (the member is
    # currently suspended under it). A timestamp means an admin reinstated
    # the member and this is when.
    lifted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
