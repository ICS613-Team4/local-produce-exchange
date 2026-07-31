# Report a member (US-37) and the admin side of reviewing those reports.
# Filing a report never changes the target member's status by itself; it
# only queues something for an admin to review and resolve later.
#
# Like the other admin-adjacent routers, the code is split into pure core
# functions (file_member_report, list_member_reports,
# resolve_member_report_as_admin), which the unit tests call directly, and
# thin HTTP routes that wire up get_current_member/require_admin and
# get_db_session.

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, Session

from app.audit_log import record_audit_log_entry
from app.db import get_db_session
from app.dependencies import get_current_member, require_admin
from app.models.member import Member
from app.models.member_report import MemberReport
from app.schemas.member_report import (
    MemberReportSummary,
    ReportMemberRequest,
    ReportMemberResponse,
    ResolveMemberReportRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# The fixed set of reasons a reporter may choose from. The category column
# itself is free text (see the model's comment), so this list can grow
# without a migration - only this constant needs to change.
MEMBER_REPORT_CATEGORIES = ["harassment", "no_show", "scam_fraud", "other"]


def file_member_report(
    reporter: Member,
    target_member_id: uuid.UUID,
    category: str,
    detail: Optional[str],
    session: Session,
) -> ReportMemberResponse:
    if category not in MEMBER_REPORT_CATEGORIES:
        raise HTTPException(status_code=422, detail="Not a recognized report category.")

    try:
        target = session.get(Member, target_member_id)
    except Exception as error:
        logger.error("Report-member target fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not file this report right now.")

    if target is None:
        raise HTTPException(status_code=404, detail="Member not found.")

    if target.id == reporter.id:
        raise HTTPException(status_code=422, detail="You cannot report yourself.")

    # One-open-report-per-target check, mirroring claim.py's one-open-request
    # check: checked first so the common case gets a clear message, with the
    # database's partial unique index (uq_member_report_one_open) as the race
    # backstop below.
    try:
        existing = session.scalars(
            select(MemberReport).where(
                MemberReport.reporter_id == reporter.id,
                MemberReport.target_member_id == target.id,
                MemberReport.status == "open",
            )
        ).first()
    except Exception as error:
        logger.error("Checking for an existing report failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not file this report right now.")

    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have an open report against this member.",
        )

    created_at = datetime.now(timezone.utc)
    new_report = MemberReport(
        reporter_id=reporter.id,
        target_member_id=target.id,
        category=category,
        detail=detail,
        status="open",
        created_at=created_at,
    )

    try:
        session.add(new_report)
        session.commit()
    except IntegrityError as error:
        # Two reports from the same reporter against the same target raced
        # past the check above; the partial unique index lets only one in.
        session.rollback()
        logger.info("Duplicate member report blocked by the unique index: %s", error)
        raise HTTPException(
            status_code=409,
            detail="You already have an open report against this member.",
        )
    except Exception as error:
        session.rollback()
        logger.error("Filing a member report failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not file this report right now.")

    return ReportMemberResponse(
        id=str(new_report.id),
        target_member_id=str(new_report.target_member_id),
        category=new_report.category,
        detail=new_report.detail,
        status=new_report.status,
        created_at=created_at.isoformat(),
    )


def list_member_reports(
    session: Session,
    status: Optional[str] = None,
    limit: Optional[int] = None,
) -> list[MemberReportSummary]:
    Reporter = aliased(Member)
    Target = aliased(Member)

    statement = (
        select(MemberReport, Reporter.name, Target.name)
        .join(Reporter, Reporter.id == MemberReport.reporter_id)
        .join(Target, Target.id == MemberReport.target_member_id)
        .order_by(MemberReport.created_at.desc(), MemberReport.id.desc())
    )
    if status is not None:
        statement = statement.where(MemberReport.status == status)
    if limit is not None:
        statement = statement.limit(limit)

    try:
        rows = session.execute(statement).all()
    except Exception as error:
        logger.error("Listing member reports failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load member reports right now.")

    results = []
    for report, reporter_name, target_name in rows:
        resolved_at = None
        if report.resolved_at is not None:
            resolved_at = report.resolved_at.isoformat()
        resolved_by = None
        if report.resolved_by is not None:
            resolved_by = str(report.resolved_by)
        results.append(
            MemberReportSummary(
                id=str(report.id),
                reporter_id=str(report.reporter_id),
                reporter_name=reporter_name,
                target_member_id=str(report.target_member_id),
                target_name=target_name,
                category=report.category,
                detail=report.detail,
                status=report.status,
                created_at=report.created_at.isoformat(),
                resolved_at=resolved_at,
                resolved_by=resolved_by,
                resolution_note=report.resolution_note,
            )
        )
    return results


def resolve_member_report_as_admin(
    acting_admin: Member,
    report_id: uuid.UUID,
    resolution_note: Optional[str],
    session: Session,
) -> None:
    try:
        report = session.get(MemberReport, report_id)
    except Exception as error:
        logger.error("Resolve-report fetch failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not resolve this report right now.")

    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")

    if report.status == "resolved":
        raise HTTPException(status_code=409, detail="Report is already resolved.")

    resolved_at = datetime.now(timezone.utc)
    report.status = "resolved"
    report.resolved_at = resolved_at
    report.resolved_by = acting_admin.id
    report.resolution_note = resolution_note
    record_audit_log_entry(
        session, acting_admin.id, "member_report_resolved", "member_report", report.id,
        reason=resolution_note, occurred_at=resolved_at,
    )

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Resolve-report commit failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not save the resolution right now.")


@router.post("/members/{member_id}/reports", status_code=201)
def file_member_report_endpoint(
    member_id: uuid.UUID,
    payload: ReportMemberRequest,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ReportMemberResponse:
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot report a member.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot report a member.",
        )
    return file_member_report(current_member, member_id, payload.category, payload.detail, session)


@router.get("/admin/member-reports")
def list_member_reports_endpoint(
    status: Annotated[str | None, Query()] = "open",
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> list[MemberReportSummary]:
    return list_member_reports(session, status=status)


@router.post("/admin/member-reports/{report_id}/resolve", status_code=204)
def resolve_member_report_endpoint(
    report_id: uuid.UUID,
    payload: ResolveMemberReportRequest,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> None:
    resolve_member_report_as_admin(current_member, report_id, payload.resolution_note, session)
