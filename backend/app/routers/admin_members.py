# Admin member search and detail endpoints (US-29: view member profile as
# admin). Kept separate from routers/members.py on purpose: those routes serve
# every member looking at their own or another member's profile; these routes
# only ever run for a caller the require_admin dependency has already checked,
# and return a wider shape (role, suspended_at) that a regular member should
# never receive.
#
# Like members.py, the code is split into pure core functions (search_members,
# get_admin_member_detail), which the unit tests call directly, and thin HTTP
# routes that wire up require_admin and get_db_session.

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import require_admin
from app.models.member import Member
from app.schemas.admin_member import AdminMemberDetail, AdminMemberSummary

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


def get_admin_member_detail(member_id: uuid.UUID, session: Session) -> AdminMemberDetail:
    try:
        member = session.scalars(select(Member).where(Member.id == member_id)).first()
    except Exception as error:
        logger.error("Admin member detail fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not fetch this member right now.")

    if member is None:
        raise HTTPException(status_code=404, detail="Member not found.")

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
