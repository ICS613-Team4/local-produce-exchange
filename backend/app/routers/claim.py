# Submit-claim endpoint. A recipient asks for a specified quantity from an
# active listing. The claim joins the listing's queue (ordered by requested_at)
# and is handled in FIFO order by later stories.

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.schemas.claim import (
    AllRequestItem,
    AllRequestsResponse,
    ClaimResponse,
    CreateClaimPayload,
    ListingAllRequestsGroup,
    ListingQueueGroup,
    MyRequestItem,
    MyRequestsResponse,
    QueueClaimItem,
    RequestQueuesResponse,
)
from app.schemas.listing import ListingPhotoRef

logger = logging.getLogger(__name__)

router = APIRouter()


def claim_can_decide(claim, listing, claimant, now):
    # The display rule for the approve/deny buttons (US-24). Returns True only
    # when this request can still be decided right now, so the dashboard and the
    # requests page know whether to offer the buttons. The decide endpoints still
    # run their own server-side checks after a click; this is a stricter,
    # display-only gate that hides the buttons when acting would just be refused.
    #
    # All five conditions must hold:
    #   1. the request is still pending (only a "requested" claim can be decided),
    #   2. the claimant's account is active (a suspended claimant cannot receive),
    #   3. the listing is active (a deactivated listing takes no decisions),
    #   4. the pickup window has not ended (now is before the window's end),
    #   5. some quantity is still left to give.
    if claim.status != "requested":
        return False
    if claimant.status != "active":
        return False
    if listing.status != "active":
        return False
    pickup_end = None
    if listing.pickup_window is not None:
        pickup_end = listing.pickup_window.upper
    # A missing or unbounded end means the window cannot be confirmed valid, so
    # do not offer the buttons. A real listing always has a bounded window
    # because create enforces it, so this guard only trips on a malformed row.
    if pickup_end is None:
        return False
    if now >= pickup_end:
        return False
    if listing.remaining_quantity <= 0:
        return False
    return True


def claim_can_deny(claim, listing, claimant, now):
    # The display rule for the deny button (US-11 Scenario 2, US-24). Deny is a
    # separate gate from approve because denying gives nothing away: it needs no
    # remaining quantity. So the owner can still deny a pending request even after
    # the listing is fully allocated (remaining is 0). Without this split, a
    # pending request on an exhausted-but-active listing would have no deny button
    # and would be stuck, even though the deny endpoint would accept it.
    #
    # The conditions are the same as claim_can_decide EXCEPT the remaining-quantity
    # check, which deny does not need:
    #   1. the request is still pending (only a "requested" claim can be denied),
    #   2. the claimant's account is active (a suspended claimant is frozen),
    #   3. the listing is active (a deactivated listing takes no decisions),
    #   4. the pickup window has not ended.
    if claim.status != "requested":
        return False
    if claimant.status != "active":
        return False
    if listing.status != "active":
        return False
    pickup_end = None
    if listing.pickup_window is not None:
        pickup_end = listing.pickup_window.upper
    if pickup_end is None:
        return False
    if now >= pickup_end:
        return False
    return True


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
    # One-request-per-listing check. A member may make only a single request on
    # a listing, ever. The state of any earlier request does not matter
    # (requested, approved, denied, or withdrawn): if this member already has any
    # claim on this listing, a second one is refused with a 409. This is checked
    # first so the common case gets a clear message; the database race backstop
    # below covers two requests that slip past this check at the same time.
    # ------------------------------------------------------------------
    try:
        existing = session.scalars(
            select(Claim).where(
                Claim.listing_id == listing_uuid,
                Claim.claimant_id == claimant_id,
            )
        ).first()
    except Exception as error:
        logger.error("Checking for an existing claim failed: %s", error)
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
            detail="You have already made a request on this listing.",
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
    except IntegrityError as error:
        # Two requests from the same member for the same listing raced past the
        # check above (a rapid double-click, or two tabs) and both tried to
        # insert. Every claim is inserted as "requested", so the unique index on
        # (listing_id, claimant_id) where status = 'requested' lets only one in
        # and rejects this one. No duplicate row was created; report the same
        # clean 409 as the duplicate case above instead of a generic 503.
        session.rollback()
        logger.info("Duplicate claim insert blocked by the unique index: %s", error)
        raise HTTPException(
            status_code=409,
            detail="You have already made a request on this listing.",
        )
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


@router.get("/listings/{listing_id}/my-claim")
def get_my_claim_for_listing(
    listing_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> Optional[ClaimResponse]:
    # The viewer's own request on one listing, whatever its status (requested,
    # approved, denied, or withdrawn). The listing detail page uses this so a
    # requester sees their current status across reloads. Returns null (no body
    # object) when the viewer has not requested this listing.

    # ------------------------------------------------------------------
    # Active-member gate, the same rule as the other claim endpoints.
    # ------------------------------------------------------------------
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

    # A listing id that is not a real UUID cannot match any listing, so the viewer
    # has no claim on it. Return null rather than an error.
    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        return None

    # Load the viewer's claim on this listing. A member may make only one request
    # per listing ever, so there is at most one row; first() returns it or None.
    try:
        claim = session.scalars(
            select(Claim)
            .where(Claim.listing_id == listing_uuid)
            .where(Claim.claimant_id == current_member.id)
        ).first()
    except Exception as error:
        logger.error("Loading the viewer's claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read your request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if claim is None:
        return None

    return ClaimResponse(
        id=str(claim.id),
        listing_id=str(claim.listing_id),
        claimant_id=str(claim.claimant_id),
        requested_quantity=claim.requested_quantity,
        approved_quantity=claim.approved_quantity,
        status=claim.status,
        requested_at=claim.requested_at,
        approved_at=claim.approved_at,
        denied_at=claim.denied_at,
        cancelled_at=claim.cancelled_at,
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

    # One "now" for the whole response, used by the can_decide display rule below
    # so every row is judged against the same instant.
    now = datetime.now(timezone.utc)

    # Decide which listings to process. With no listing query value, use all of
    # the caller's listings, ordered by title. With a listing value, use just
    # that one listing after the ownership check below.
    listings_to_process = []
    if listing is None:
        try:
            owned_listings = session.scalars(
                select(Listing)
                .where(Listing.owner_id == member_id)
                # The id is a tiebreaker so listings that share a created_at sort
                # in a stable, repeatable order, not an arbitrary one.
                .order_by(Listing.created_at.desc(), Listing.id.desc())
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
            pending_claim_rows = session.execute(
                select(Claim, Member)
                .join(Member, Claim.claimant_id == Member.id)
                .where(Claim.listing_id == listing_row.id)
                .where(Claim.status == "requested")
                # Oldest first (FIFO), with the id as a tiebreaker so two claims
                # that share a requested_at always come out in the same order.
                .order_by(Claim.requested_at.asc(), Claim.id.asc())
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

        if len(pending_claim_rows) == 0:
            continue

        pending_items = []
        for claim_result in pending_claim_rows:
            claim_row = claim_result[0]
            claimant = claim_result[1]
            claimant_name = claimant.name
            can_decide = claim_can_decide(claim_row, listing_row, claimant, now)
            can_deny = claim_can_deny(claim_row, listing_row, claimant, now)
            pending_items.append(
                QueueClaimItem(
                    id=str(claim_row.id),
                    claimant_id=str(claim_row.claimant_id),
                    claimant_name=claimant_name,
                    requested_quantity=claim_row.requested_quantity,
                    requested_at=claim_row.requested_at,
                    can_decide=can_decide,
                    can_deny=can_deny,
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


@router.get("/request-queues/all")
def get_all_requests(
    listing: Annotated[str | None, Query()] = None,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> AllRequestsResponse:
    # The poster's full request history across their listings (US-24), grouped
    # by listing, every status. This is separate from get_request_queues
    # (pending-only) so the dashboard's live queue is unchanged. Two differences
    # from the pending endpoint: it keeps every claim status, not just
    # "requested", and it includes an active listing even when it has no
    # requests (as an empty group), so the page can show a listing-level note.
    # A non-active listing is kept only while it still has requests, so the
    # poster can finish exchanges that were already in flight when the listing
    # was deactivated; each group carries listing_status so the page can mark
    # those. A deactivated listing with no requests drops out.

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

    # One "now" for the whole response, used by the can_decide display rule.
    now = datetime.now(timezone.utc)

    # Decide which listings to process. With no listing query value, use all of
    # the caller's listings, newest first (non-active ones are dropped below
    # when they have no requests). With a listing value, use just that one
    # listing after the ownership check below.
    listings_to_process = []
    if listing is None:
        try:
            owned_listings = session.scalars(
                select(Listing)
                .where(Listing.owner_id == member_id)
                .order_by(Listing.created_at.desc(), Listing.id.desc())
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
        # listing, so return no groups rather than an error.
        try:
            listing_uuid = uuid.UUID(listing)
        except (ValueError, AttributeError, TypeError):
            return AllRequestsResponse(groups=[])

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

        # No such listing reads as no groups, the same as a malformed id.
        if one_listing is None:
            return AllRequestsResponse(groups=[])

        # A listing the caller does not own is denied, before any claim is read,
        # the same as get_request_queues.
        if one_listing.owner_id != member_id:
            raise HTTPException(
                status_code=403,
                detail="You can only view requests for your own listings.",
            )

        # A non-active listing is processed like any other here; the loop below
        # drops it only when it has no requests, the same rule as the full list.
        listings_to_process.append(one_listing)

    # Load every listed listing's photos in one query and group them by listing
    # id, so each group can show the listing's cover photo. One extra query for
    # the page, not one per listing, the same batching the browse response uses.
    photo_listing_ids = []
    for listing_row in listings_to_process:
        photo_listing_ids.append(listing_row.id)
    photos_by_listing = {}
    if photo_listing_ids:
        try:
            photo_rows = session.scalars(
                select(ListingPhoto)
                .where(ListingPhoto.listing_id.in_(photo_listing_ids))
                .order_by(ListingPhoto.position)
            ).all()
        except Exception as error:
            logger.error("Loading listing photos for the queues failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated."
                ),
            )
        for photo_row in photo_rows:
            key = photo_row.listing_id
            if key not in photos_by_listing:
                photos_by_listing[key] = []
            photos_by_listing[key].append(
                ListingPhotoRef(
                    id=str(photo_row.id),
                    content_type=photo_row.content_type,
                    position=photo_row.position,
                )
            )

    # For each listing, load ALL its claims oldest-first and build a group.
    # Unlike the pending endpoint, an ACTIVE listing with no claims is kept as
    # an empty group so the page can show its listing-level empty note. A
    # non-active listing is kept only while it has claims to show.
    groups = []
    for listing_row in listings_to_process:
        try:
            all_claim_rows = session.execute(
                select(Claim, Member)
                .join(Member, Claim.claimant_id == Member.id)
                .where(Claim.listing_id == listing_row.id)
                # Oldest first, with the id as a tiebreaker so two claims that
                # share a requested_at always come out in the same order.
                .order_by(Claim.requested_at.asc(), Claim.id.asc())
            ).all()
        except Exception as error:
            logger.error("Loading claims failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated."
                ),
            )

        request_items = []
        for claim_result in all_claim_rows:
            claim_row = claim_result[0]
            claimant = claim_result[1]
            claimant_name = claimant.name
            can_decide = claim_can_decide(claim_row, listing_row, claimant, now)
            can_deny = claim_can_deny(claim_row, listing_row, claimant, now)
            request_items.append(
                AllRequestItem(
                    id=str(claim_row.id),
                    claimant_id=str(claim_row.claimant_id),
                    claimant_name=claimant_name,
                    requested_quantity=claim_row.requested_quantity,
                    approved_quantity=claim_row.approved_quantity,
                    status=claim_row.status,
                    requested_at=claim_row.requested_at,
                    approved_at=claim_row.approved_at,
                    picked_up_at=claim_row.picked_up_at,
                    completed_at=claim_row.completed_at,
                    denied_at=claim_row.denied_at,
                    cancelled_at=claim_row.cancelled_at,
                    can_decide=can_decide,
                    can_deny=can_deny,
                )
            )

        # A non-active listing with nothing left to show drops out entirely.
        if listing_row.status != "active" and len(request_items) == 0:
            continue

        groups.append(
            ListingAllRequestsGroup(
                listing_id=str(listing_row.id),
                listing_title=listing_row.title,
                listing_status=listing_row.status,
                remaining_quantity=listing_row.remaining_quantity,
                requests=request_items,
                created_at=listing_row.created_at,
                photos=photos_by_listing.get(listing_row.id, []),
            )
        )

    return AllRequestsResponse(groups=groups)


def build_my_request_items(session, claims):
    # Turn a list of the caller's claim rows into MyRequestItem rows for the
    # my-requests page. Reads each claim's listing through the relationship for
    # the title. A claim whose listing is missing is skipped. A database error
    # while reading the listing becomes a 503, like the other reads.

    # First pass: pair each claim with its listing, skipping missing listings.
    claim_listing_pairs = []
    for claim_row in claims:
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
        claim_listing_pairs.append((claim_row, listing_row))

    # Load every listed listing's photos in one query and group them by listing
    # id, so the page can show each request's cover photo. One extra query per
    # section, not one per row, the same batching the browse response uses.
    listing_ids = []
    for claim_row, listing_row in claim_listing_pairs:
        if listing_row.id not in listing_ids:
            listing_ids.append(listing_row.id)
    photos_by_listing = {}
    if listing_ids:
        try:
            photo_rows = session.scalars(
                select(ListingPhoto)
                .where(ListingPhoto.listing_id.in_(listing_ids))
                .order_by(ListingPhoto.position)
            ).all()
        except Exception as error:
            logger.error("Loading requested listing photos failed: %s", error)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Could not read your requests right now. "
                    "Make sure the database is running and migrated."
                ),
            )
        for photo_row in photo_rows:
            key = photo_row.listing_id
            if key not in photos_by_listing:
                photos_by_listing[key] = []
            photos_by_listing[key].append(
                ListingPhotoRef(
                    id=str(photo_row.id),
                    content_type=photo_row.content_type,
                    position=photo_row.position,
                )
            )

    items = []
    for claim_row, listing_row in claim_listing_pairs:
        # The listing's owner is who the caller requested from (the provider), so
        # the my-requests page can show their name. The owner foreign key is
        # required, but guard a missing owner row with an empty name rather than
        # failing the whole response.
        owner_name = ""
        if listing_row.owner is not None:
            owner_name = listing_row.owner.name
        items.append(
            MyRequestItem(
                id=str(claim_row.id),
                listing_id=str(listing_row.id),
                listing_title=listing_row.title,
                owner_name=owner_name,
                requested_quantity=claim_row.requested_quantity,
                approved_quantity=claim_row.approved_quantity,
                status=claim_row.status,
                requested_at=claim_row.requested_at,
                approved_at=claim_row.approved_at,
                picked_up_at=claim_row.picked_up_at,
                completed_at=claim_row.completed_at,
                denied_at=claim_row.denied_at,
                cancelled_at=claim_row.cancelled_at,
                photos=photos_by_listing.get(listing_row.id, []),
            )
        )
    return items


@router.get("/my-requests")
def get_my_requests(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> MyRequestsResponse:
    # The caller's own requests, split into five sections for the my-requests
    # page: pending (still waiting), approved, completed, denied, and withdrawn.
    # Each section is newest first, by the time the request entered that state,
    # with the claim id as a tiebreaker so the order is stable and repeatable. A
    # member has at most one request per listing, so each request stands on its
    # own.

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

    # Load each section in its own query. Pending sorts by when it was requested,
    # approved by when it was approved, completed by when it was completed,
    # denied by when it was denied; all newest first, all with the claim id as
    # the tiebreaker.
    try:
        pending_claims = session.scalars(
            select(Claim)
            .where(Claim.claimant_id == member_id)
            .where(Claim.status == "requested")
            .order_by(Claim.requested_at.desc(), Claim.id.desc())
        ).all()
        approved_claims = session.scalars(
            select(Claim)
            .where(Claim.claimant_id == member_id)
            .where(Claim.status.in_(["approved", "picked_up"]))
            .order_by(Claim.approved_at.desc(), Claim.id.desc())
        ).all()
        completed_claims = session.scalars(
            select(Claim)
            .where(Claim.claimant_id == member_id)
            .where(Claim.status == "completed")
            .order_by(Claim.completed_at.desc(), Claim.id.desc())
        ).all()
        denied_claims = session.scalars(
            select(Claim)
            .where(Claim.claimant_id == member_id)
            .where(Claim.status == "denied")
            .order_by(Claim.denied_at.desc(), Claim.id.desc())
        ).all()
        withdrawn_claims = session.scalars(
            select(Claim)
            .where(Claim.claimant_id == member_id)
            .where(Claim.status == "cancelled")
            .order_by(Claim.cancelled_at.desc(), Claim.id.desc())
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

    pending_items = build_my_request_items(session, pending_claims)
    approved_items = build_my_request_items(session, approved_claims)
    completed_items = build_my_request_items(session, completed_claims)
    denied_items = build_my_request_items(session, denied_claims)
    withdrawn_items = build_my_request_items(session, withdrawn_claims)

    return MyRequestsResponse(
        pending=pending_items,
        approved=approved_items,
        completed=completed_items,
        denied=denied_items,
        withdrawn=withdrawn_items,
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
    # Load the claim and lock its row (SELECT ... FOR UPDATE) so two approvals
    # of the SAME request cannot run at once. The lock is held until this
    # request commits, so a second approval of this claim (a double-click, a
    # second tab, or a scripted click) waits here, then reads the now-approved
    # status below and is rejected. This is the database, not the app, enforcing
    # one decision per claim, so no amount of fast clicking can process it twice.
    # ------------------------------------------------------------------
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid).with_for_update()
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
    # Workflow rule (Scenario 4). The claim must be in REQUESTED status. This is
    # read under the claim row lock above, so a concurrent approval that already
    # moved it to "approved" is seen here and stops this one.
    # ------------------------------------------------------------------
    if claim.status != "requested":
        raise HTTPException(
            status_code=409,
            detail="This request is not pending, so it cannot be approved.",
        )

    # ------------------------------------------------------------------
    # Load the listing and lock its row too (SELECT ... FOR UPDATE). The
    # remaining quantity is read, compared, and lowered below; locking the row
    # serializes that read-modify-write across requests, so two approvals of
    # DIFFERENT claims on the same listing cannot both read the same remaining
    # quantity and each subtract from it. Without this lock, two approvals could
    # together allocate more than the listing actually has. The lock makes the
    # second approval wait, then read the already-lowered remaining quantity.
    # Claims are always locked before listings (here and in deny), so the lock
    # order is consistent and cannot deadlock.
    # ------------------------------------------------------------------
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id).with_for_update()
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
    # Nothing left to give. The listing has no remaining quantity, so there
    # is nothing to allocate. approved_quantity must be greater than 0, so a
    # zero allocation is not allowed; reject with a 409.
    # ------------------------------------------------------------------
    if listing.remaining_quantity <= 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot approve: this listing has no remaining quantity.",
        )

    # ------------------------------------------------------------------
    # Apply the approval. Partial fill: allocate as much as the request asks
    # for, but never more than what the listing has left. So a request for 5
    # against a remaining quantity of 2 records an approved_quantity of 2.
    # The original requested_quantity is left unchanged, so the record shows
    # both numbers. The listing's remaining quantity drops by the allocated
    # amount, which can bring it to exactly 0 but never below.
    # ------------------------------------------------------------------
    if claim.requested_quantity < listing.remaining_quantity:
        allocated_quantity = claim.requested_quantity
    else:
        allocated_quantity = listing.remaining_quantity

    now = datetime.now(timezone.utc)

    claim.status = "approved"
    claim.approved_quantity = allocated_quantity
    claim.approved_at = now
    listing.remaining_quantity -= allocated_quantity

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


@router.patch("/claims/{claim_id}/pickup")
def confirm_pickup(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # ------------------------------------------------------------------
    # Permission gate. Only an active member may confirm pickup.
    # ------------------------------------------------------------------
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot confirm pickup.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot confirm pickup.",
        )

    # ------------------------------------------------------------------
    # Parse the claim id.
    # ------------------------------------------------------------------
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Request not found.")

    # ------------------------------------------------------------------
    # Load the claim and lock its row so the pickup confirmation cannot run
    # twice on the same request.
    # ------------------------------------------------------------------
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid).with_for_update()
        ).first()
    except Exception as error:
        logger.error("Loading claim for pickup confirmation failed: %s", error)
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
    # Permission rule. Only the claimant may confirm pickup.
    # ------------------------------------------------------------------
    if claim.claimant_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="Only the requestor can confirm pickup for this request.",
        )

    # ------------------------------------------------------------------
    # Workflow rule. Only an approved claim can be marked as picked up.
    # ------------------------------------------------------------------
    if claim.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="Only an approved request can be marked as picked up.",
        )

    # ------------------------------------------------------------------
    # Apply the pickup confirmation.
    # ------------------------------------------------------------------
    now = datetime.now(timezone.utc)
    claim.status = "picked_up"
    claim.picked_up_at = now

    # Cache values before commit expires loaded attributes.
    claim_id_out = claim.id
    listing_id_out = claim.listing_id
    claimant_id_out = claim.claimant_id
    requested_quantity_out = claim.requested_quantity
    approved_quantity_out = claim.approved_quantity
    requested_at_out = claim.requested_at
    approved_at_out = claim.approved_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Confirming pickup failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not confirm pickup right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ClaimResponse(
        id=str(claim_id_out),
        listing_id=str(listing_id_out),
        claimant_id=str(claimant_id_out),
        requested_quantity=requested_quantity_out,
        approved_quantity=approved_quantity_out,
        status="picked_up",
        requested_at=requested_at_out,
        approved_at=approved_at_out,
        picked_up_at=now,
    )


@router.patch("/claims/{claim_id}/complete")
def complete_exchange(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # Only an active member may complete an exchange.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot complete an exchange.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot complete an exchange.",
        )

    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Request not found.")

    # Lock the claim so two completion requests cannot update it at once.
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid).with_for_update()
        ).first()
    except Exception as error:
        logger.error("Loading claim for completion failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if claim is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    if claim.status != "picked_up":
        raise HTTPException(
            status_code=409,
            detail="This exchange is not picked up, so it cannot be completed.",
        )

    # The listing is read without a lock because completion changes no listing fields.
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id)
        ).first()
    except Exception as error:
        logger.error("Loading listing for completion failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    if listing.owner_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="Only the listing owner can complete the exchange.",
        )

    now = datetime.now(timezone.utc)
    claim.status = "completed"
    claim.completed_at = now

    # NOTIFY SEAM (US-22): notify claim.claimant_id in this transaction when notifications exist.

    claim_id_out = claim.id
    listing_id_out = claim.listing_id
    claimant_id_out = claim.claimant_id
    requested_quantity_out = claim.requested_quantity
    approved_quantity_out = claim.approved_quantity
    requested_at_out = claim.requested_at
    approved_at_out = claim.approved_at
    picked_up_at_out = claim.picked_up_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Completing an exchange failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not complete the exchange right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ClaimResponse(
        id=str(claim_id_out),
        listing_id=str(listing_id_out),
        claimant_id=str(claimant_id_out),
        requested_quantity=requested_quantity_out,
        approved_quantity=approved_quantity_out,
        status="completed",
        requested_at=requested_at_out,
        approved_at=approved_at_out,
        picked_up_at=picked_up_at_out,
        completed_at=now,
    )


@router.patch("/claims/{claim_id}/cancel")
def cancel_exchange(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # The poster calls off an exchange they already approved, before pickup.
    # The claim goes to "cancelled" and the quantity that approval reserved
    # goes back to the listing. Only an APPROVED claim can be cancelled this
    # way: a pending one is denied instead, and a picked-up or completed one
    # is already in the recipient's hands.

    # Only an active member may cancel an exchange.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot cancel an exchange.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot cancel an exchange.",
        )

    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Request not found.")

    # Lock the claim so two cancellations (or a cancellation racing a pickup
    # confirmation) cannot update it at once.
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid).with_for_update()
        ).first()
    except Exception as error:
        logger.error("Loading claim for cancellation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if claim is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    if claim.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="This exchange is not approved, so it cannot be cancelled.",
        )

    # Load the listing and lock its row too: the reserved quantity is returned
    # below, and the lock serializes that read-modify-write against approvals
    # of other claims on the same listing. Claims are always locked before
    # listings here, the same fixed order as approve and deny.
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id).with_for_update()
        ).first()
    except Exception as error:
        logger.error("Loading listing for cancellation failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not process the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Request not found.")

    if listing.owner_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="Only the listing owner can cancel the exchange.",
        )

    # Apply the cancellation. The quantity the approval moved off the listing
    # goes back, so it can be offered to someone else.
    now = datetime.now(timezone.utc)

    if claim.approved_quantity is not None:
        listing.remaining_quantity = listing.remaining_quantity + claim.approved_quantity
    claim.status = "cancelled"
    claim.cancelled_at = now

    # NOTIFY SEAM (US-22): notify claim.claimant_id in this transaction when notifications exist.

    claim_id_out = claim.id
    listing_id_out = claim.listing_id
    claimant_id_out = claim.claimant_id
    requested_quantity_out = claim.requested_quantity
    approved_quantity_out = claim.approved_quantity
    requested_at_out = claim.requested_at
    approved_at_out = claim.approved_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Cancelling an exchange failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not cancel the exchange right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ClaimResponse(
        id=str(claim_id_out),
        listing_id=str(listing_id_out),
        claimant_id=str(claimant_id_out),
        requested_quantity=requested_quantity_out,
        approved_quantity=approved_quantity_out,
        status="cancelled",
        requested_at=requested_at_out,
        approved_at=approved_at_out,
        cancelled_at=now,
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
    # Load the claim and lock its row (SELECT ... FOR UPDATE) so the same claim
    # cannot be denied twice, or denied and approved, at the same time. The lock
    # is held until commit, so a racing decision on this claim waits here and
    # then reads the updated status below and is rejected. Denial does not change
    # any quantity, so the listing is read below without a lock, only to check
    # ownership.
    # ------------------------------------------------------------------
    try:
        claim = session.scalars(
            select(Claim).where(Claim.id == claim_uuid).with_for_update()
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
    # Workflow rule (Scenario 4). The claim must be in REQUESTED status. Read
    # under the claim row lock above, so a concurrent decision is seen here.
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


@router.patch("/claims/{claim_id}/withdraw")
def withdraw_claim(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ClaimResponse:
    # ------------------------------------------------------------------
    # Permission gate. Only an active member may withdraw a claim.
    # ------------------------------------------------------------------
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot withdraw a request.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot withdraw a request.",
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
        logger.error("Loading claim for withdrawal failed: %s", error)
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
    # Permission rule (Scenario 3). Only the claimant may withdraw.
    # ------------------------------------------------------------------
    if claim.claimant_id != current_member.id:
        raise HTTPException(
            status_code=403,
            detail="You can only withdraw your own request.",
        )

    # ------------------------------------------------------------------
    # Workflow rule (Scenario 2). Only a REQUESTED claim can be withdrawn.
    # ------------------------------------------------------------------
    if claim.status != "requested":
        raise HTTPException(
            status_code=409,
            detail="This request is not pending, so it cannot be withdrawn.",
        )

    # ------------------------------------------------------------------
    # Apply the withdrawal. No quantity changes.
    # ------------------------------------------------------------------
    now = datetime.now(timezone.utc)

    claim.status = "cancelled"
    claim.cancelled_at = now

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
        logger.error("Withdrawing a claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not withdraw the request right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ClaimResponse(
        id=str(claim_id_out),
        listing_id=str(listing_id_out),
        claimant_id=str(claimant_id_out),
        requested_quantity=requested_quantity_out,
        status="cancelled",
        requested_at=requested_at_out,
        cancelled_at=now,
    )
