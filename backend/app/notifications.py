# A small shared helper for saving an in-app notification. A notification is a
# short saved message a member sees the next time they open their notifications
# page. This helper is called by the status-change routes (in claim.py and
# thread.py) at each point where the code says a member "is notified". It does
# session.add only and does NOT commit, so the calling route's own commit saves
# the notification in the SAME transaction as the status change. That way a
# notification is never saved for a change that rolled back.

import logging

from app.models.notification import Notification

logger = logging.getLogger(__name__)


def create_notification(session, member_id, claim_id, kind, message):
    # member_id is the recipient (who should see this). claim_id is the related
    # exchange so the member can open it (may be None). kind is a short label
    # like "request_approved". message is the human-readable line.
    notification = Notification(
        member_id=member_id,
        claim_id=claim_id,
        kind=kind,
        message=message,
    )
    session.add(notification)
    return notification
