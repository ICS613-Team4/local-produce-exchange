# Admin basic activity report (US-28: generate basic reports).
#
# The AC and UC-25 do not specify exact report content, so this covers the
# manual test plan's own placeholder assumption: counts of listings,
# requests, and completed exchanges, plus member counts (everything already
# modeled, no new tables). Computed live on every call - nothing is stored,
# so there is no report history to browse, only "generate one now".
#
# Like the other admin routers, the code is split into a pure core function
# (generate_report), which the unit tests call directly, and a thin HTTP
# route that wires up require_admin and get_db_session.

import logging
from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import require_admin
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.admin_report import AdminReport

logger = logging.getLogger(__name__)

router = APIRouter()

LISTING_STATUSES = ["active", "claimed", "expired", "cancelled", "deactivated"]
CLAIM_STATUSES = ["requested", "approved", "picked_up", "completed", "cancelled", "denied"]
MEMBER_STATUSES = ["active", "suspended", "inactive"]


def _zero_filled(statuses: list[str]) -> dict[str, int]:
    counts = {}
    for status in statuses:
        counts[status] = 0
    return counts


def _count_by_status(
    session: Session,
    model,
    statuses: list[str],
    date_column,
    start_at: Optional[datetime],
    end_at: Optional[datetime],
) -> dict[str, int]:
    statement = select(model.status, func.count()).group_by(model.status)
    if start_at is not None:
        statement = statement.where(date_column >= start_at)
    if end_at is not None:
        statement = statement.where(date_column <= end_at)

    counts = _zero_filled(statuses)
    for status, count in session.execute(statement).all():
        counts[status] = count
    return counts


def generate_report(
    start_date: Optional[date],
    end_date: Optional[date],
    session: Session,
) -> AdminReport:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must not be after end_date.")

    # A date range is inclusive of both endpoints, so the end date's bound
    # reaches the end of that calendar day, not its first instant.
    start_at = None
    if start_date is not None:
        start_at = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    end_at = None
    if end_date is not None:
        end_at = datetime.combine(end_date, time.max, tzinfo=timezone.utc)

    try:
        listings_by_status = _count_by_status(
            session, Listing, LISTING_STATUSES, Listing.created_at, start_at, end_at
        )
        requests_by_status = _count_by_status(
            session, Claim, CLAIM_STATUSES, Claim.requested_at, start_at, end_at
        )
        members_by_status = _count_by_status(
            session, Member, MEMBER_STATUSES, Member.created_at, start_at, end_at
        )

        # Completed exchanges are counted by when they were completed, not
        # when they were requested: a claim requested before the range can
        # still complete inside it, and one requested inside the range may
        # not have completed yet. requests_by_status['completed'] answers a
        # different question (requests submitted in range that are now
        # complete), so this is a separate query, not a reuse of that count.
        completed_statement = select(func.count()).select_from(Claim).where(Claim.completed_at.is_not(None))
        if start_at is not None:
            completed_statement = completed_statement.where(Claim.completed_at >= start_at)
        if end_at is not None:
            completed_statement = completed_statement.where(Claim.completed_at <= end_at)
        completed_exchanges = session.execute(completed_statement).scalar_one()
    except Exception as error:
        logger.error("Generating the admin report failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not generate the report right now.")

    start_date_text = start_date.isoformat() if start_date is not None else None
    end_date_text = end_date.isoformat() if end_date is not None else None

    return AdminReport(
        start_date=start_date_text,
        end_date=end_date_text,
        generated_at=datetime.now(timezone.utc).isoformat(),
        listings_by_status=listings_by_status,
        total_listings=sum(listings_by_status.values()),
        requests_by_status=requests_by_status,
        total_requests=sum(requests_by_status.values()),
        completed_exchanges=completed_exchanges,
        members_by_status=members_by_status,
        total_members=sum(members_by_status.values()),
    )


@router.get("/admin/reports")
def generate_report_endpoint(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> AdminReport:
    return generate_report(start_date, end_date, session)
