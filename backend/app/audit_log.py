# A small shared helper for recording an admin audit-log entry (US-35). This
# is called by the routers that perform an admin action (suspend/unsuspend a
# member, deactivate a listing, resolve a member report) at the point the
# code says an admin "did" that action. It does session.add only and does NOT
# commit, so the calling route's own commit saves the entry in the SAME
# transaction as the action itself. That way an audit-log entry is never
# saved for a change that rolled back.

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from app.models.admin_audit_log import AdminAuditLog

logger = logging.getLogger(__name__)


def record_audit_log_entry(
    session,
    admin_id: Optional[UUID],
    action: str,
    target_type: str,
    target_id: UUID,
    reason: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
):
    entry = AdminAuditLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        created_at=occurred_at or datetime.now(timezone.utc),
    )
    session.add(entry)
    return entry
