from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# One notification, shaped for the notifications page. claim_id is the related
# exchange the member can open (null when a notification has no claim). is_read
# is shown read-only here; US-23 owns marking it read.
class NotificationItem(BaseModel):
    id: str
    claim_id: Optional[str] = None
    kind: str
    message: str
    is_read: bool
    created_at: datetime


# The whole response: the caller's own notifications, newest first. An empty
# list means the member has no notifications (Scenario 2). A wrapper object is
# used (not a bare list) to match the other endpoints and so the unread count
# can ride along with the list.
#
# unread_count is how many of the caller's notifications have is_read false. The
# header bell shows it as a badge, so the header needs no second request. During
# US-22 nothing marks a notification read, so this always equals the list
# length; it is counted from is_read anyway so it stays right once US-23 lands.
class NotificationsResponse(BaseModel):
    notifications: list[NotificationItem]
    unread_count: int


# The header bell's own tiny response. The header polls for this every few
# seconds, so it carries the count and nothing else: no list, no message bodies,
# no field that grows as the member collects more notifications.
class UnreadCountResponse(BaseModel):
    unread_count: int
