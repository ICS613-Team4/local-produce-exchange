# Admin member search, detail, suspend, and unsuspend endpoints (US-29, US-25,
# US-26). Kept separate from routers/members.py on purpose: those routes serve
# every member looking at their own or another member's profile; these routes
# only ever run for a caller the require_admin dependency has already checked,
# and return a wider shape (role, suspended_at) that a regular member should
# never receive.
#
# Like members.py, the code is split into pure core functions (search_members,
# get_admin_member_detail, suspend_member, unsuspend_member), which the unit
# tests call directly, and thin HTTP routes that wire up require_admin and
# get_db_session.

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import require_admin
from app.models.member import Member
from app.models.suspension_record import SuspensionRecord
from app.schemas.admin_member import AdminMemberDetail, AdminMemberSummary, SuspendMemberRequest

logger = logging.getLogger(__name__)

router = APIRouter()


def search_members(query: str, session: Session, limit: int = 50) -> list[AdminMemberSummary]:
    # Scenario 2 (no matches): a blank query returns no rows rather than
    # dumping the full member table, since nothing was actually searched for.
    stripped_query = query.strip()
    if stripped_query == "":
        return []

    pattern = "%" + stripped_query + "%"
    statement = (
        select(Member)
        .where(or_(Member.name.ilike(pattern), Member.email.ilike(pattern)))
        .order_by(Member.name, Member.id)
        .limit(limit)
    )

    try:
        rows = session.scalars(statement).all()
    except Exception as error:
        logger.error("Admin member search failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not search members right now.")

    results = []
    for row in rows:
        results.append(
            AdminMemberSummary(id=str(row.id), name=row.name, email=row.email, status=row.status)
        )
    return results


def _to_admin_member_detail(member: Member) -> AdminMemberDetail:
    display_name = None
    neighborhood = None
    contact_preference = None
    if member.profile is not None:
        display_name = member.profile.display_name
        neighborhood = member.profile.neighborhood
        contact_preference = member.profile.contact_preference

    suspended_at = None
    if member.suspended_at is not None:
        suspended_at = member.suspended_at.isoformat()

    return AdminMemberDetail(
        id=str(member.id),
        name=member.name,
        email=member.email,
        status=member.status,
        role=member.role,
        created_at=member.created_at.isoformat(),
        suspended_at=suspended_at,
        display_name=display_name,
        neighborhood=neighborhood,
        contact_preference=contact_preference,
    )


def get_admin_member_detail(member_id: uuid.UUID, session: Session) -> AdminMemberDetail:
    try:
        member = session.scalars(select(Member).where(Member.id == member_id)).first()
    except Exception as error:
        logger.error("Admin member detail fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not fetch this member right now.")

    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    return _to_admin_member_detail(member)


def suspend_member(
    acting_admin: Member,
    member_id: uuid.UUID,
    reason: Optional[str],
    session: Session,
) -> AdminMemberDetail:
    # US-25, Scenario 1.
    try:
        member = session.scalars(select(Member).where(Member.id == member_id)).first()
    except Exception as error:
        logger.error("Suspend-member fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not suspend this member right now.")

    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    # There is no admin hierarchy in this schema (see US-29's admin-viewing-
    # admin decision), so this endpoint refuses an admin target the same way
    # the detail page hides the button for one - which also covers an admin
    # trying to suspend themselves, since that is the same role check.
    if member.role == "admin":
        raise HTTPException(status_code=403, detail="Cannot suspend an admin account.")

    if member.status == "suspended":
        raise HTTPException(status_code=409, detail="Member is already suspended.")

    now = datetime.now(timezone.utc)
    member.status = "suspended"
    member.suspended_at = now
    session.add(
        SuspensionRecord(
            member_id=member.id,
            admin_id=acting_admin.id,
            reason=reason,
            created_at=now,
        )
    )

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Suspend-member commit failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not save the suspension right now.")

    return _to_admin_member_detail(member)


def unsuspend_member(member_id: uuid.UUID, session: Session) -> AdminMemberDetail:
    # US-26, Scenario 1.
    try:
        member = session.scalars(select(Member).where(Member.id == member_id)).first()
    except Exception as error:
        logger.error("Unsuspend-member fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not reinstate this member right now.")

    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    if member.status != "suspended":
        raise HTTPException(status_code=409, detail="Member is not suspended.")

    member.status = "active"
    member.suspended_at = None

    try:
        open_record = session.scalars(
            select(SuspensionRecord)
            .where(SuspensionRecord.member_id == member.id)
            .where(SuspensionRecord.lifted_at.is_(None))
            .order_by(SuspensionRecord.created_at.desc())
        ).first()
    except Exception as error:
        logger.error("Loading the open suspension record failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not reinstate this member right now.")

    # A member marked suspended always has an open record, written by
    # suspend_member above. This stays None only for data suspended before
    # this table existed, or written directly (seeding, a migration); either
    # way, reinstating the member still works, there is just no episode left
    # to close.
    if open_record is not None:
        open_record.lifted_at = datetime.now(timezone.utc)

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Unsuspend-member commit failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not save the reinstatement right now.")

    return _to_admin_member_detail(member)


@router.get("/admin/members")
def search_members_endpoint(
    q: Annotated[str | None, Query()] = None,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> list[AdminMemberSummary]:
    return search_members(q or "", session)


@router.get("/admin/members/{member_id}")
def get_admin_member_endpoint(
    member_id: uuid.UUID,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> AdminMemberDetail:
    return get_admin_member_detail(member_id, session)


@router.post("/admin/members/{member_id}/suspend")
def suspend_member_endpoint(
    member_id: uuid.UUID,
    payload: SuspendMemberRequest,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> AdminMemberDetail:
    return suspend_member(current_member, member_id, payload.reason, session)


@router.post("/admin/members/{member_id}/unsuspend")
def unsuspend_member_endpoint(
    member_id: uuid.UUID,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> AdminMemberDetail:
    return unsuspend_member(member_id, session)
