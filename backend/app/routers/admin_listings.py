import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import require_admin
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.admin_listing import AdminListingSummary

logger = logging.getLogger(__name__)

router = APIRouter()


def list_admin_listings(session: Session) -> list[AdminListingSummary]:
    statement = (
        select(Listing, Member.name)
        .join(Member, Member.id == Listing.owner_id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )
    try:
        rows = session.execute(statement).all()
    except Exception as error:
        logger.error("Admin listing inventory failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not load listings right now.",
        )

    results = []
    for listing, owner_name in rows:
        deactivated_by = None
        if listing.deactivated_by is not None:
            deactivated_by = str(listing.deactivated_by)
        results.append(
            AdminListingSummary(
                id=str(listing.id),
                owner_id=str(listing.owner_id),
                owner_name=owner_name,
                title=listing.title,
                status=listing.status,
                deactivated_by=deactivated_by,
            )
        )
    return results


def deactivate_listing_as_admin(
    acting_admin: Member,
    listing_id: uuid.UUID,
    session: Session,
) -> None:
    # Lock existing pending claims first, matching the project's claim-before-
    # listing lock order used by approve/cancel operations.
    try:
        session.scalars(
            select(Claim)
            .where(Claim.listing_id == listing_id)
            .where(Claim.status == "requested")
            .with_for_update()
        ).all()
        listing = session.scalars(
            select(Listing).where(Listing.id == listing_id).with_for_update()
        ).first()
    except Exception as error:
        logger.error("Admin listing lookup for deactivation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not read the listing right now.",
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found.")

    if listing.status != "active":
        raise HTTPException(status_code=409, detail="Listing is not active.")

    # Claim creation locks the listing row before inserting. If a claim creator
    # held that lock while this operation was waiting, its new row was not in the
    # first query. Refresh under locks after acquiring the listing so every claim
    # committed before deactivation is included and cancelled atomically.
    try:
        pending_claims = session.scalars(
            select(Claim)
            .where(Claim.listing_id == listing.id)
            .where(Claim.status == "requested")
            .with_for_update()
        ).all()
    except Exception as error:
        logger.error("Loading pending claims for admin deactivation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not deactivate the listing right now.",
        )

    now = datetime.now(timezone.utc)
    for pending_claim in pending_claims:
        pending_claim.status = "cancelled"
        pending_claim.cancelled_at = now

    listing.status = "deactivated"
    listing.deactivated_by = acting_admin.id
    listing.deactivated_at = now

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Admin listing deactivation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not deactivate the listing right now.",
        )

    return None


def reactivate_listing_as_admin(
    listing_id: uuid.UUID,
    session: Session,
) -> None:
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == listing_id).with_for_update()
        ).first()
    except Exception as error:
        logger.error("Admin listing lookup for reactivation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not read the listing right now.",
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found.")

    if listing.status == "active":
        raise HTTPException(status_code=409, detail="Listing is already active.")

    if listing.status != "deactivated":
        raise HTTPException(
            status_code=409,
            detail="Only a deactivated listing can be reactivated.",
        )

    listing.status = "active"
    listing.deactivated_by = None
    listing.deactivated_at = None

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Admin listing reactivation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not reactivate the listing right now.",
        )

    return None


@router.get("/admin/listings")
def list_admin_listings_endpoint(
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> list[AdminListingSummary]:
    return list_admin_listings(session)


@router.post("/admin/listings/{listing_id}/deactivate", status_code=204)
def deactivate_admin_listing_endpoint(
    listing_id: uuid.UUID,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> None:
    return deactivate_listing_as_admin(current_member, listing_id, session)


@router.post("/admin/listings/{listing_id}/reactivate", status_code=204)
def reactivate_admin_listing_endpoint(
    listing_id: uuid.UUID,
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> None:
    return reactivate_listing_as_admin(listing_id, session)
