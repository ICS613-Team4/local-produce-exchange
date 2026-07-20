# Exchange-history endpoint (US-24). One GET returns every exchange the caller
# is part of, on either side: their own requests on other members' listings
# (the recipient side) and the requests other members made on the caller's
# listings (the poster side). The response groups the rows by claim status,
# and each row carries the caller's side, because status alone does not decide
# which control a row gets: an approved row is a confirm-pickup row for the
# recipient only, and a picked-up row is a complete-exchange row for the
# poster only. A member can hold both sides at the same status, so the side is
# per row.

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.exchange_history import ExchangeHistoryItem, ExchangeHistoryResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def build_exchange_history_items(claims, member_id):
    # Turn claim rows into ExchangeHistoryItem rows. Each claim's listing and
    # names are read through the relationships, the same way the my-requests
    # endpoint builds its rows. A claim whose listing is missing is skipped
    # rather than failing the whole response.
    items = []
    for claim_row in claims:
        listing_row = claim_row.listing
        if listing_row is None:
            continue

        # The caller's side on this row. The create-claim route refuses a
        # request on the caller's own listing, so a claim is never both.
        if claim_row.claimant_id == member_id:
            side = "recipient"
            # The other party is the listing's owner (the poster). Guard a
            # missing owner row with an empty name rather than failing.
            other_party_name = ""
            if listing_row.owner is not None:
                other_party_name = listing_row.owner.name
        else:
            side = "poster"
            # The other party is the member who made the request.
            other_party_name = ""
            if claim_row.claimant is not None:
                other_party_name = claim_row.claimant.name

        items.append(
            ExchangeHistoryItem(
                id=str(claim_row.id),
                listing_id=str(claim_row.listing_id),
                listing_title=listing_row.title,
                side=side,
                other_party_name=other_party_name,
                requested_quantity=claim_row.requested_quantity,
                approved_quantity=claim_row.approved_quantity,
                status=claim_row.status,
                requested_at=claim_row.requested_at,
                approved_at=claim_row.approved_at,
                picked_up_at=claim_row.picked_up_at,
                completed_at=claim_row.completed_at,
                cancelled_at=claim_row.cancelled_at,
                denied_at=claim_row.denied_at,
            )
        )
    return items


@router.get("/exchange-history")
def get_exchange_history(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ExchangeHistoryResponse:
    # Active-member gate, same rule and messages as the other claim endpoints.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot view your exchange history.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot view your exchange history.",
        )

    member_id = current_member.id

    # Load each status group in its own query, the same per-section pattern the
    # my-requests endpoint uses. Every query joins the listing so it can match
    # both sides at once: the caller as claimant (recipient side) or the caller
    # as the listing's owner (poster side). Each group sorts newest first by
    # the time the claim entered that status, with the claim id as a tiebreaker
    # so the order is stable and repeatable.
    try:
        requested_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.status == "requested")
            .where(or_(Claim.claimant_id == member_id, Listing.owner_id == member_id))
            .order_by(Claim.requested_at.desc(), Claim.id.desc())
        ).all()
        approved_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.status == "approved")
            .where(or_(Claim.claimant_id == member_id, Listing.owner_id == member_id))
            .order_by(Claim.approved_at.desc(), Claim.id.desc())
        ).all()
        picked_up_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.status == "picked_up")
            .where(or_(Claim.claimant_id == member_id, Listing.owner_id == member_id))
            .order_by(Claim.picked_up_at.desc(), Claim.id.desc())
        ).all()
        completed_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.status == "completed")
            .where(or_(Claim.claimant_id == member_id, Listing.owner_id == member_id))
            .order_by(Claim.completed_at.desc(), Claim.id.desc())
        ).all()
        cancelled_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.status == "cancelled")
            .where(or_(Claim.claimant_id == member_id, Listing.owner_id == member_id))
            .order_by(Claim.cancelled_at.desc(), Claim.id.desc())
        ).all()
        denied_claims = session.scalars(
            select(Claim)
            .join(Listing, Claim.listing_id == Listing.id)
            .where(Claim.status == "denied")
            .where(or_(Claim.claimant_id == member_id, Listing.owner_id == member_id))
            .order_by(Claim.denied_at.desc(), Claim.id.desc())
        ).all()

        requested_items = build_exchange_history_items(requested_claims, member_id)
        approved_items = build_exchange_history_items(approved_claims, member_id)
        picked_up_items = build_exchange_history_items(picked_up_claims, member_id)
        completed_items = build_exchange_history_items(completed_claims, member_id)
        cancelled_items = build_exchange_history_items(cancelled_claims, member_id)
        denied_items = build_exchange_history_items(denied_claims, member_id)
    except Exception as error:
        logger.error("Loading the caller's exchange history failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read your exchange history right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    return ExchangeHistoryResponse(
        requested=requested_items,
        approved=approved_items,
        picked_up=picked_up_items,
        completed=completed_items,
        cancelled=cancelled_items,
        denied=denied_items,
    )
