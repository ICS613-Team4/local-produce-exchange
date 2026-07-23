# Request and response shapes for the admin member search and detail views
# (US-29). Separate from schemas/member.py: these are only ever returned to an
# admin caller (enforced by require_admin), and carry fields a regular member
# should never see over this shape, like suspended_at.

from typing import Optional

from pydantic import BaseModel


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
