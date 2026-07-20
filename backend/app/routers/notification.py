# Notification read endpoints. A member reads only their OWN notifications,
# newest first, and the header bell polls a count-only endpoint for its badge.
# The write side lives in app/notifications.py (the create_notification helper),
# called by the status-change routes in claim.py and thread.py.

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.member import Member
from app.models.notification import Notification
from app.schemas.notification import (
    MarkNotificationReadResponse,
    NotificationItem,
    NotificationsResponse,
    UnreadCountResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/notifications")
def get_notifications(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> NotificationsResponse:
    # The caller reads only their own notifications, newest first. Scenario 2
    # (no notifications) returns an empty list.

    # Active-status gate, the same rule the claim read endpoints use.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot view notifications.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot view notifications.",
        )

    member_id = current_member.id

    try:
        rows = session.scalars(
            select(Notification)
            .where(Notification.member_id == member_id)
            # Newest first, with the id as a tiebreaker so two notifications that
            # share a created_at always come out in the same order.
            .order_by(Notification.created_at.desc(), Notification.id.desc())
        ).all()
    except Exception as error:
        logger.error("Loading the caller's notifications failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read your notifications right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    items = []
    # Count the unread ones while building the list, so the header bell gets its
    # badge number from this same response instead of a second request.
    unread_count = 0
    for row in rows:
        claim_id_value = None
        if row.claim_id is not None:
            claim_id_value = str(row.claim_id)
        if row.is_read is False:
            unread_count = unread_count + 1
        items.append(
            NotificationItem(
                id=str(row.id),
                claim_id=claim_id_value,
                kind=row.kind,
                message=row.message,
                is_read=row.is_read,
                created_at=row.created_at,
            )
        )

    return NotificationsResponse(notifications=items, unread_count=unread_count)


# Route-order note for future stories: FastAPI matches routes in declaration
# order. Both routes here are literal paths, so their order does not matter
# today, but a future path-parameter route like /notifications/{notification_id}
# must be declared AFTER any literal path such as /notifications/unread-count,
# or the literal segment would be captured as an id.
@router.get("/notifications/unread-count")
def get_unread_count(
    response: Response,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> UnreadCountResponse:
    # The header bell polls this every few seconds, so it counts in the database
    # and returns one number instead of loading any rows.

    # A stale count must never come back from a browser or proxy cache.
    response.headers["Cache-Control"] = "no-store"

    # Same active-status gate as the list endpoint above.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot view notifications.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot view notifications.",
        )

    member_id = current_member.id

    try:
        unread_count = session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.member_id == member_id)
            .where(Notification.is_read.is_(False))
        )
    except Exception as error:
        logger.error("Counting the caller's unread notifications failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read your notifications right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    # count() gives 0 for a member with no rows, but guard anyway so the response
    # is always an int and never null.
    if unread_count is None:
        unread_count = 0

    return UnreadCountResponse(unread_count=unread_count)


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> MarkNotificationReadResponse:
    # Mark one of the caller's own notifications read (US-23). Marking is
    # one-way and idempotent: marking an already-read notification is accepted
    # and changes nothing (Scenario 2).

    # Active-status gate, the same rule the read endpoints above use.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot update notifications.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot update notifications.",
        )

    # Parse the id. A non-UUID string cannot match any notification.
    try:
        notification_uuid = uuid.UUID(notification_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Notification not found.")

    # Load the notification. Like withdraw_claim, this single-row owner-only
    # flip changes no other row and no quantity, so it loads without a row lock.
    try:
        notification = session.scalars(
            select(Notification).where(Notification.id == notification_uuid)
        ).first()
    except Exception as error:
        logger.error("Loading a notification to mark read failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not update the notification right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found.")

    # Ownership rule. Only the recipient may mark their own notification read.
    # Checked before the read-state branch, so a non-owner never learns whether
    # the notification was read.
    if notification.member_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="You can only mark your own notifications read.",
        )

    # Scenario 2: already read. Return success without an error and change
    # nothing. The stored read_at is left exactly as it was, so a repeat is a
    # no-op.
    if notification.is_read:
        return MarkNotificationReadResponse(
            id=str(notification.id),
            is_read=True,
            read_at=notification.read_at,
        )

    # Scenario 1: flip it to read and stamp the time.
    now = datetime.now(timezone.utc)
    notification.is_read = True
    notification.read_at = now

    # Cache values before commit expires loaded attributes.
    notification_id_out = notification.id
    read_at_out = notification.read_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Marking a notification read failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not update the notification right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return MarkNotificationReadResponse(
        id=str(notification_id_out),
        is_read=True,
        read_at=read_at_out,
    )
