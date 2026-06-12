import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Member(Base):
    __tablename__ = "member"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        SAEnum("active", "suspended", "inactive", name="member_status", create_type=False),
        server_default="active",
    )
    role: Mapped[str] = mapped_column(
        SAEnum("member", "admin", name="member_role", create_type=False),
        server_default="member",
    )
    suspended_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default="now()")

    profile: Mapped[Optional["MemberProfile"]] = relationship(
        back_populates="member",
        uselist=False,
        cascade="all, delete-orphan",
    )
    invite_tokens_created: Mapped[List["InviteToken"]] = relationship(
        foreign_keys="[InviteToken.created_by]",
        back_populates="creator",
    )


class MemberProfile(Base):
    __tablename__ = "member_profile"

    member_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("member.id", ondelete="CASCADE"),
        primary_key=True,
    )
    display_name: Mapped[Optional[str]] = mapped_column(Text)
    contact_preference: Mapped[Optional[str]] = mapped_column(
        SAEnum("email", "message", "either", name="contact_pref", create_type=False),
    )
    neighborhood: Mapped[Optional[str]] = mapped_column(Text)

    member: Mapped["Member"] = relationship(back_populates="profile")


class InviteToken(Base):
    __tablename__ = "invite_token"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("member.id"))
    used_by: Mapped[Optional[uuid.UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey("member.id"))
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "used", "expired", name="invite_status", create_type=False),
        server_default="pending",
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    used_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))

    creator: Mapped["Member"] = relationship(
        foreign_keys="[InviteToken.created_by]",
        back_populates="invite_tokens_created",
    )
    redeemer: Mapped[Optional["Member"]] = relationship(
        foreign_keys="[InviteToken.used_by]",
    )
