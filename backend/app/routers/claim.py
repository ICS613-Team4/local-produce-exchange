# Submit-claim endpoint. A recipient asks for a specified quantity from an
# active listing. The claim joins the listing's queue (ordered by requested_at)
# and is handled in FIFO order by later stories.

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.claim import (
    ClaimResponse,
    CreateClaimPayload,
    ListingQueueGroup,
    QueueClaimItem,
    RequestQueuesResponse,
)

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


@router.get("/request-queues")
def get_request_queues(
    listing: Annotated[str | None, Query()] = None,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> RequestQueuesResponse:
    # The poster's view of the pending requests on their listings (US-10 / UC-10).
    # A pending request is a Claim with status "requested"; the queue order is
    # requested_at ascending (oldest first). This is read-only: one GET that
    # returns the caller's own listing queues. With ?listing=<id> it returns just
    # that one listing's queue, after checking the caller owns it, which is how
    # scenario 3 (a non-owner cannot view another's queue) is enforced.

    # Active-member gate. The insecure X-Member-Id header means a forged
    # suspended id could otherwise read requests, so a non-active acting member
    # is denied before any listing or claim is read, matching get_listing and
    # create_claim.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot view requests.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot view requests.",
        )

    member_id = current_member.id

    # Decide which listings to process. With no listing query value, use all of
    # the caller's listings, ordered by title. With a listing value, use just
    # that one listing after the ownership check below.
    listings_to_process = []
    if listing is None:
        try:
            owned_listings = session.scalars(
                select(Listing)
                .where(Listing.owner_id == member_id)
                .order_by(Listing.created_at.desc())
            ).all()
        except Exception as error:
            logger.error("Loading the caller's listings failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated: "
                    "npm run db:up, then npm run db:migrate, then npm run db:seed."
                ),
            )
        for owned_listing in owned_listings:
            listings_to_process.append(owned_listing)
    else:
        # A filtered request. A value that is not a real UUID cannot match any
        # listing, so return an empty queue rather than an error. The page shows
        # its "no pending requests on this listing yet" message for this.
        try:
            listing_uuid = uuid.UUID(listing)
        except (ValueError, AttributeError, TypeError):
            return RequestQueuesResponse(groups=[])

        try:
            one_listing = session.scalars(
                select(Listing).where(Listing.id == listing_uuid)
            ).first()
        except Exception as error:
            logger.error("Loading the filtered listing failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated."
                ),
            )

        # No such listing reads as an empty queue, the same as a malformed id.
        if one_listing is None:
            return RequestQueuesResponse(groups=[])

        # A listing the caller does not own is denied (scenario 3). No queue rows
        # leak: the 403 is raised before any claim is read.
        if one_listing.owner_id != member_id:
            raise HTTPException(
                status_code=403,
                detail="You can only view requests for your own listings.",
            )

        listings_to_process.append(one_listing)

    # For each listing, load its pending claims oldest-first and build a group.
    # A listing with no pending claims is skipped, so the response only carries
    # listings that currently have requests. Because the no-filter list is
    # ordered newest-first above, the groups come out newest-listing-first too.
    groups = []
    for listing_row in listings_to_process:
        try:
            pending_claims = session.scalars(
                select(Claim)
                .where(Claim.listing_id == listing_row.id)
                .where(Claim.status == "requested")
                .order_by(Claim.requested_at.asc())
            ).all()
        except Exception as error:
            logger.error("Loading pending claims failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated."
                ),
            )

        if len(pending_claims) == 0:
            continue

        pending_items = []
        for claim_row in pending_claims:
            # Read the claimant's name through the relationship. Wrap it so a
            # database error during this read returns 503 like the others.
            try:
                claimant_name = claim_row.claimant.name
            except Exception as error:
                logger.error("Loading a claimant name failed: %s", error)
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "Could not read your requests right now. "
                        "Make sure the database is running and migrated."
                    ),
                )
            pending_items.append(
                QueueClaimItem(
                    id=str(claim_row.id),
                    claimant_id=str(claim_row.claimant_id),
                    claimant_name=claimant_name,
                    requested_quantity=claim_row.requested_quantity,
                    requested_at=claim_row.requested_at,
                )
            )

        groups.append(
            ListingQueueGroup(
                listing_id=str(listing_row.id),
                listing_title=listing_row.title,
                listing_status=listing_row.status,
                remaining_quantity=listing_row.remaining_quantity,
                pending=pending_items,
            )
        )

    return RequestQueuesResponse(groups=groups)


@router.get("/my-requests")
def get_my_requests(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> RequestQueuesResponse:
    # The flip side of get_request_queues: the pending requests the caller has
    # made on OTHER members' listings (the outgoing view). Grouped by the listing
    # requested on, newest listing first, each group holding the caller's own
    # pending request. Reuses the same response shape and the same frontend
    # rendering as the incoming queue, so the format matches.

    # Active-member gate, same rule and messages as get_request_queues.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot view requests.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot view requests.",
        )

    member_id = current_member.id
    member_name = current_member.name

    # Load the caller's pending claims, ordered by the listing's created_at so the
    # newest listing comes first, matching the incoming queue's group order. The
    # join is only for that ordering; the listing fields are read below.
    try:
        my_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.claimant_id == member_id)
            .where(Claim.status == "requested")
            .order_by(Listing.created_at.desc())
        ).all()
    except Exception as error:
        logger.error("Loading the caller's requests failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read your requests right now. "
                "Make sure the database is running and migrated."
            ),
        )

    # Build one group per claim. A member has at most one open request per listing
    # (the unique partial index), so each listing appears once. Read the listing
    # through the relationship for its title, status, and remaining quantity.
    groups = []
    for claim_row in my_claims:
        try:
            listing_row = claim_row.listing
        except Exception as error:
            logger.error("Loading a requested listing failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated."
                ),
            )
        if listing_row is None:
            continue
        pending_items = []
        pending_items.append(
            QueueClaimItem(
                id=str(claim_row.id),
                claimant_id=str(member_id),
                claimant_name=member_name,
                requested_quantity=claim_row.requested_quantity,
                requested_at=claim_row.requested_at,
            )
        )
        groups.append(
            ListingQueueGroup(
                listing_id=str(listing_row.id),
                listing_title=listing_row.title,
                listing_status=listing_row.status,
                remaining_quantity=listing_row.remaining_quantity,
                pending=pending_items,
            )
        )

    return RequestQueuesResponse(groups=groups)
