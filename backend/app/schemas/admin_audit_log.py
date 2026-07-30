# Request and response shapes for the admin audit log (US-35).

from typing import Optional

from pydantic import BaseModel


class AdminAuditLogEntry(BaseModel):
    id: str
    admin_id: Optional[str]
    admin_name: Optional[str]
    action: str
    target_type: str
    target_id: str
    target_label: Optional[str]
    reason: Optional[str]
    created_at: str


class AdminAuditLogResponse(BaseModel):
    entries: list[AdminAuditLogEntry]
    total_count: int
    start_date: Optional[str]
    end_date: Optional[str]
