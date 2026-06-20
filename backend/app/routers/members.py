# Member profile endpoints: view and update.
#
# The code is split into two parts on purpose:
#   - get_member_profile() and update_member_profile() are the pure cores.
#     They take loaded objects and session; the unit tests call them directly
#     without any HTTP layer.
#   - get_member_endpoint() and update_member_endpoint() are the thin HTTP
#     routes. The acting member arrives through the shared get_current_member
#     dependency (X-Member-Id header), the same identity path the other routes
#     use.

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.member import Member
from app.schemas.member import MemberProfileRead, MemberProfileUpdate, MemberRead

logger = logging.getLogger(__name__)

router = APIRouter()


def _to_member_read(member: Member) -> MemberRead:
    profile = None
    if member.profile is not None:
        profile = MemberProfileRead(
            display_name=member.profile.display_name,
            contact_preference=member.profile.contact_preference,
            neighborhood=member.profile.neighborhood,
        )
    return MemberRead(
        id=str(member.id),
        name=member.name,
        email=member.email,
        status=member.status,
        role=member.role,
        created_at=member.created_at.isoformat(),
        profile=profile,
    )


def get_member_profile(member_id: uuid.UUID, session: Session) -> MemberRead:
    try:
        member = session.scalars(select(Member).where(Member.id == member_id)).first()
    except Exception as error:
        logger.error("Profile fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not fetch profile right now.")

    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    return _to_member_read(member)


def update_member_profile(
    acting_member: Member,
    member_id: uuid.UUID,
    payload: MemberProfileUpdate,
    session: Session,
) -> MemberRead:
    # Authorization gate (Scenario 3). Only the member can edit their own profile.
    if acting_member.id != member_id:
        raise HTTPException(status_code=403, detail="You can only edit your own profile.")

    try:
        member = session.scalars(select(Member).where(Member.id == member_id)).first()
    except Exception as error:
        logger.error("Profile update fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not update profile right now.")

    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    if member.profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")

    if payload.display_name is not None:
        stripped = payload.display_name.strip()
        if stripped == "":
            raise HTTPException(status_code=422, detail="Display name must not be blank.")
        member.profile.display_name = stripped

    if payload.contact_preference is not None:
        member.profile.contact_preference = payload.contact_preference

    if payload.neighborhood is not None:
        member.profile.neighborhood = payload.neighborhood.strip() or None

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Profile update commit failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not save profile right now.")

    return _to_member_read(member)


@router.get("/members/{member_id}")
def get_member_endpoint(
    member_id: uuid.UUID,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> MemberRead:
    return get_member_profile(member_id, session)


@router.patch("/members/{member_id}")
def update_member_endpoint(
    member_id: uuid.UUID,
    payload: MemberProfileUpdate,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> MemberRead:
    return update_member_profile(current_member, member_id, payload, session)
