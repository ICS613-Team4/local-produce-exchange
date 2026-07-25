# Request and response shapes for the admin member search, detail, and
# suspend/unsuspend actions (US-29, US-25, US-26). Separate from
# schemas/member.py: these are only ever returned to an admin caller (enforced
# by require_admin), and carry fields a regular member should never see over
# this shape, like suspended_at.

from typing import Optional

from pydantic import BaseModel, Field


class AdminMemberSummary(BaseModel):
    id: str
    name: str
    email: str
    status: str


class AdminMemberDetail(BaseModel):
    id: str
    name: str
    email: str
    status: str
    role: str
    created_at: str
    suspended_at: Optional[str]
    display_name: Optional[str]
    neighborhood: Optional[str]
    contact_preference: Optional[str]


class SuspendMemberRequest(BaseModel):
    # Optional: the AC does not require a reason, but an admin may want to
    # leave one for the audit trail (suspension_record.reason).
    reason: Optional[str] = Field(default=None, max_length=1000)
