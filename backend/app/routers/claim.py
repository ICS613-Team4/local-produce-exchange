# Submit-claim endpoint. A recipient asks for a specified quantity from an
# active listing. The claim joins the listing's queue (ordered by requested_at)
# and is handled in FIFO order by later stories.

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.claim import ClaimResponse, CreateClaimPayload

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/listings/{listing_id}/claims", status_code=201)
def create_claim(
    listing_id: str,
    payload: CreateClaimPayload,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # ------------------------------------------------------------------
    # Permission gate (Scenario 5). A suspended or otherwise non-active
    # member cannot submit a claim.
    # ------------------------------------------------------------------
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot submit a request.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot submit a request.",
        )

    claimant_id = current_member.id

    # ------------------------------------------------------------------
    # Parse the listing id. A non-UUID string cannot match any listing.
    # ------------------------------------------------------------------
    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Listing not found.")

    # ------------------------------------------------------------------
    # Load the listing. It must exist and be active.
    # ------------------------------------------------------------------
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == listing_uuid)
        ).first()
    except Exception as error:
        logger.error("Loading listing for claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found.")

    if listing.status != "active":
        raise HTTPException(status_code=404, detail="Listing not found.")

    # ------------------------------------------------------------------
    # Self-request guard. The owner cannot claim their own listing.
    # ------------------------------------------------------------------
    if listing.owner_id == claimant_id:
        raise HTTPException(
            status_code=403,
            detail="You cannot request your own listing.",
        )

    # ------------------------------------------------------------------
    # Quantity validation (Scenarios 2-3). Pydantic already rejects
    # quantity <= 0 via Field(gt=0), returning a 422. The route adds the
    # remaining-quantity ceiling so the message is listing-specific.
    # ------------------------------------------------------------------
    if payload.quantity > listing.remaining_quantity:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Requested quantity ({payload.quantity}) exceeds "
                f"available quantity ({listing.remaining_quantity})."
            ),
        )

    # ------------------------------------------------------------------
    # Duplicate open-claim check (Scenario 4). The unique partial index
    # prevents this at the database level, but checking first lets us give
    # a clear 409 instead of a raw constraint-violation error.
    # ------------------------------------------------------------------
    try:
        existing = session.scalars(
            select(Claim).where(
                Claim.listing_id == listing_uuid,
                Claim.claimant_id == claimant_id,
                Claim.status == "requested",
            )
        ).first()
    except Exception as error:
        logger.error("Checking for duplicate claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have an open request on this listing.",
        )

    # ------------------------------------------------------------------
    # Insert the claim.
    # ------------------------------------------------------------------
    requested_at = datetime.now(timezone.utc)

    new_claim = Claim(
        listing_id=listing_uuid,
        claimant_id=claimant_id,
        requested_quantity=payload.quantity,
        status="requested",
        requested_at=requested_at,
    )

    try:
        session.add(new_claim)
        session.flush()
        new_claim_id = new_claim.id
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Creating a claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not create the request right now. "
                "Make sure the database is running and migrated."
            ),
        )
    return ClaimResponse(
        id=str(new_claim_id),
        listing_id=str(listing_uuid),
        claimant_id=str(claimant_id),
        requested_quantity=payload.quantity,
        status="requested",
        requested_at=requested_at,
    )


@router.patch("/claims/{claim_id}/approve")
def approve_claim(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # ------------------------------------------------------------------
    # Permission gate. Only an active member may act on a claim.
    # ------------------------------------------------------------------
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot approve a request.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot approve a request.",
        )

    # ------------------------------------------------------------------
    # Parse the claim id.
    # ------------------------------------------------------------------
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Load the claim.
    # ------------------------------------------------------------------
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid)
        ).first()
    except Exception as error:
        logger.error("Loading claim for approval failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if claim is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Workflow rule (Scenario 4). The claim must be in REQUESTED status.
    # ------------------------------------------------------------------
    if claim.status != "requested":
        raise HTTPException(
            status_code=409,
            detail="This request is not pending, so it cannot be approved.",
        )

    # ------------------------------------------------------------------
    # Load the listing so we can check ownership and remaining quantity.
    # ------------------------------------------------------------------
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id)
        ).first()
    except Exception as error:
        logger.error("Loading listing for claim approval failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Permission rule (Scenario 5). Only the listing owner may approve.
    # ------------------------------------------------------------------
    if listing.owner_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="Only the listing owner can approve or deny requests.",
        )

    # ------------------------------------------------------------------
    # Conflict prevention (Scenario 3). The requested quantity must not
    # exceed the listing's remaining quantity.
    # ------------------------------------------------------------------
    if claim.requested_quantity > listing.remaining_quantity:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot approve: requested quantity ({claim.requested_quantity}) "
                f"exceeds remaining quantity ({listing.remaining_quantity})."
            ),
        )

    # ------------------------------------------------------------------
    # Apply the approval. All-or-nothing: approved_quantity equals the
    # full requested_quantity. Reduce the listing's remaining quantity.
    # ------------------------------------------------------------------
    now = datetime.now(timezone.utc)

    claim.status = "approved"
    claim.approved_quantity = claim.requested_quantity
    claim.approved_at = now
    listing.remaining_quantity -= claim.requested_quantity

    # Cache values before commit expires loaded attributes.
    claim_id_out = claim.id
    listing_id_out = claim.listing_id
    claimant_id_out = claim.claimant_id
    requested_quantity_out = claim.requested_quantity
    approved_quantity_out = claim.approved_quantity
    requested_at_out = claim.requested_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Approving a claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not approve the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ClaimResponse(
        id=str(claim_id_out),
        listing_id=str(listing_id_out),
        claimant_id=str(claimant_id_out),
        requested_quantity=requested_quantity_out,
        approved_quantity=approved_quantity_out,
        status="approved",
        requested_at=requested_at_out,
        approved_at=now,
    )


@router.patch("/claims/{claim_id}/deny")
def deny_claim(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # ------------------------------------------------------------------
    # Permission gate. Only an active member may act on a claim.
    # ------------------------------------------------------------------
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot deny a request.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot deny a request.",
        )

    # ------------------------------------------------------------------
    # Parse the claim id.
    # ------------------------------------------------------------------
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Load the claim.
    # ------------------------------------------------------------------
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid)
        ).first()
    except Exception as error:
        logger.error("Loading claim for denial failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if claim is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Workflow rule (Scenario 4). The claim must be in REQUESTED status.
    # ------------------------------------------------------------------
    if claim.status != "requested":
        raise HTTPException(
            status_code=409,
            detail="This request is not pending, so it cannot be denied.",
        )

    # ------------------------------------------------------------------
    # Load the listing so we can check ownership.
    # ------------------------------------------------------------------
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id)
        ).first()
    except Exception as error:
        logger.error("Loading listing for claim denial failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Permission rule (Scenario 5). Only the listing owner may deny.
    # ------------------------------------------------------------------
    if listing.owner_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="Only the listing owner can approve or deny requests.",
        )

    # ------------------------------------------------------------------
    # Apply the denial. No quantity changes on denial.
    # ------------------------------------------------------------------
    now = datetime.now(timezone.utc)

    claim.status = "denied"
    claim.denied_at = now

    # Cache values before commit expires loaded attributes.
    claim_id_out = claim.id
    listing_id_out = claim.listing_id
    claimant_id_out = claim.claimant_id
    requested_quantity_out = claim.requested_quantity
    requested_at_out = claim.requested_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Denying a claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not deny the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ClaimResponse(
        id=str(claim_id_out),
        listing_id=str(listing_id_out),
        claimant_id=str(claimant_id_out),
        requested_quantity=requested_quantity_out,
        status="denied",
        requested_at=requested_at_out,
        denied_at=now,
    )

