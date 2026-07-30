# Request and response shapes for reporting a member (US-37): a member
# filing a report against another member, and an admin listing/resolving
# those reports.

from typing import Optional

from pydantic import BaseModel, Field


class ReportMemberRequest(BaseModel):
    category: str
    detail: Optional[str] = Field(default=None, max_length=1000)


class ReportMemberResponse(BaseModel):
    id: str
    target_member_id: str
    category: str
    detail: Optional[str]
    status: str
    created_at: str


# One report, shaped for an admin's list view. reporter_name/target_name are
# joined in so the admin never has to make a second lookup per row.
class MemberReportSummary(BaseModel):
    id: str
    reporter_id: str
    reporter_name: str
    target_member_id: str
    target_name: str
    category: str
    detail: Optional[str]
    status: str
    created_at: str
    resolved_at: Optional[str]
    resolved_by: Optional[str]
    resolution_note: Optional[str]


class ResolveMemberReportRequest(BaseModel):
    resolution_note: Optional[str] = Field(default=None, max_length=1000)


# A wrapper object (not a bare list), matching NotificationsResponse's shape,
# so open_count can ride along with the list for a badge/count display.
class AdminMemberReportsResponse(BaseModel):
    reports: list[MemberReportSummary]
    open_count: int
