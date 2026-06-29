import uuid
from datetime import datetime
from typing import List

from sqlalchemy import ForeignKey, Index, Text, TIMESTAMP, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class MessageThread(Base):
    __tablename__ = "message_thread"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    claim_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("claim.id", ondelete="CASCADE"),
        unique=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )

    messages: Mapped[List["Message"]] = relationship(
        back_populates="thread",
        order_by="Message.sent_at.asc()",
        cascade="all, delete-orphan",
    )


class Message(Base):
    __tablename__ = "message"
    __table_args__ = (
        Index("idx_message_thread_id", "thread_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    thread_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("message_thread.id", ondelete="CASCADE"),
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id"),
    )
    body: Mapped[str] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=text("now()"),
    )

    thread: Mapped["MessageThread"] = relationship(back_populates="messages")
