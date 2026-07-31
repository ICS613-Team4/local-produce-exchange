# The admin landing page (US-38): a live at-a-glance snapshot, plus the most
# recent open member reports and admin actions, so an admin sees what needs
# attention without an extra click. The full, date-filterable Activity
# Report (admin_reports.py) still exists separately for the detailed case
# and the PDF export; this endpoint is deliberately lighter weight - no date
# range, just "right now".

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import require_admin
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.admin_audit_log import list_audit_log
from app.routers.member_report import list_member_reports
from app.schemas.admin_dashboard import AdminDashboardSnapshot

logger = logging.getLogger(__name__)

router = APIRouter()

RECENT_MEMBER_REPORTS_LIMIT = 10
RECENT_ADMIN_ACTIONS_LIMIT = 5


def build_admin_dashboard_snapshot(session: Session) -> AdminDashboardSnapshot:
    try:
        active_listings = session.execute(
            select(func.count()).select_from(Listing).where(Listing.status == "active")
        ).scalar_one()
        open_requests = session.execute(
            select(func.count()).select_from(Claim).where(Claim.status == "requested")
        ).scalar_one()
        members_currently_suspended = session.execute(
            select(func.count()).select_from(Member).where(Member.status == "suspended")
        ).scalar_one()
    except Exception as error:
        logger.error("Building the admin dashboard snapshot failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the admin dashboard right now.")

    open_reports = list_member_reports(session, status="open")
    recent_reports = open_reports[:RECENT_MEMBER_REPORTS_LIMIT]
    recent_actions = list_audit_log(
        session, None, None, limit=RECENT_ADMIN_ACTIONS_LIMIT
    ).entries

    return AdminDashboardSnapshot(
        generated_at=datetime.now(timezone.utc).isoformat(),
        active_listings=active_listings,
        open_requests=open_requests,
        members_currently_suspended=members_currently_suspended,
        open_member_reports_count=len(open_reports),
        recent_member_reports=recent_reports,
        recent_admin_actions=recent_actions,
    )


@router.get("/admin/dashboard")
def get_admin_dashboard_endpoint(
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> AdminDashboardSnapshot:
    return build_admin_dashboard_snapshot(session)
