# Response shape for the admin landing page (US-38): a live snapshot plus
# the most recent open member reports and admin actions.

from pydantic import BaseModel

from app.schemas.admin_audit_log import AdminAuditLogEntry
from app.schemas.member_report import MemberReportSummary


class AdminDashboardSnapshot(BaseModel):
    generated_at: str
    active_listings: int
    open_requests: int
    # The count of members whose status is currently "suspended" - a live
    # current-state count. Deliberately distinct from AdminReport's
    # members_suspended, which counts suspend ACTIONS taken within a date
    # range on the full Activity Report; the two answer different questions
    # and are not interchangeable.
    members_currently_suspended: int
    open_member_reports_count: int
    recent_member_reports: list[MemberReportSummary]
    recent_admin_actions: list[AdminAuditLogEntry]
