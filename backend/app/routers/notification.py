# Notification read endpoints. A member reads only their OWN notifications,
# newest first, and the header bell polls a count-only endpoint for its badge.
# The write side lives in app/notifications.py (the create_notification helper),
# called by the status-change routes in claim.py and thread.py.

import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.member import Member
from app.models.notification import Notification
from app.schemas.notification import (
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
