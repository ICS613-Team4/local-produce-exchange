# Review endpoints (US-20): leave, read, and edit a rating and review for a
# completed exchange.
#
# Split into pure cores and thin HTTP routes (same pattern as thread.py):
#   - get_review_context(), create_review(), and edit_review() are the
#     testable cores.
#   - get_review_context_endpoint(), create_review_endpoint(), and
#     edit_review_endpoint() are the HTTP wrappers.
#
# Who may act is decided in one shared helper so the three endpoints cannot
# drift apart: the acting member must be the listing owner or the requestor
# (the claimant) of the claim, and everyone else gets 403 before the claim's
# status is ever revealed.
#
# Three data-integrity rules, enforced here and in the database:
#   Rule 1: one member leaves at most one review per exchange, ever. The
#           uq_review_claim_reviewer unique constraint is the enforcement of
#           record; the duplicate check here is the friendly 409 on top.
#   Rule 2: a reviewer may edit their own review, in place. The edit URL
#           carries no review id, so the only reachable row is the acting
#           member's own.
#   Rule 3: a review an admin disabled is frozen. The author may not edit it
#           and may not write a replacement, and both refusals carry the same
#           plain sentence telling the member an administrator disabled it.
#           The duplicate check therefore counts disabled reviews on purpose.

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.review import Review
from app.schemas.review import (
    CreateReviewPayload,
    EditReviewPayload,
    ReviewContextResponse,
    ReviewResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# The one sentence a member sees when an admin disabled their review. The
# create block, the edit block, and the screen all show this same sentence, so
# it lives in one constant and can never drift apart.
DISABLED_REVIEW_MESSAGE = (
    "An administrator disabled your review for this exchange because it broke "
    "the community rules. You cannot edit it or leave a new review for this "
    "exchange."
)

DATABASE_GUIDANCE = (
    "Make sure the database is running and migrated: "
    "npm run db:up, then npm run db:migrate, then npm run db:seed."
)


def _check_member_is_active(acting_member: Member, action_text: str) -> None:
    # The server-side backstop for a suspended or inactive account. Login is
    # meant to keep them out already; this re-check means no review endpoint
    # trusts that. action_text finishes the sentence, for example
    # "leave a review".
    if acting_member.status != "active":
        if acting_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot " + action_text + ".",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot " + action_text + ".",
        )


def _load_exchange_for_review(
    claim_uuid: uuid.UUID,
    acting_member: Member,
    session: Session,
    lock: bool,
) -> tuple[Claim, Listing, uuid.UUID, str, str]:
    """Load the claim and listing, and verify the acting member is a party.

    Returns (claim, listing, reviewee_id, acting_role, reviewee_role) on
    success, where the roles are "listing_owner" or "requestor". Raises
    HTTPException otherwise. When lock is true the claim row is locked with
    SELECT ... FOR UPDATE, which serializes two review submissions for the
    same exchange.
    """
    try:
        if lock:
            claim = session.scalars(
                select(Claim).where(Claim.id == claim_uuid).with_for_update()
            ).first()
        else:
            claim = session.scalars(select(Claim).where(Claim.id == claim_uuid)).first()
    except Exception as error:
        logger.error("Review: loading claim failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not load the exchange right now. " + DATABASE_GUIDANCE,
        )

    if claim is None:
        raise HTTPException(status_code=404, detail="Exchange not found.")

    # The listing is read without a lock: a review changes no listing field.
    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id)
        ).first()
    except Exception as error:
        logger.error("Review: loading listing failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not load the exchange right now. " + DATABASE_GUIDANCE,
        )

    if listing is None:
        raise HTTPException(status_code=404, detail="Exchange not found.")

    # The participant check runs BEFORE any status check, so a member who is
    # not part of this exchange cannot learn its status from the status code.
    is_owner = listing.owner_id == acting_member.id
    is_requestor = claim.claimant_id == acting_member.id
    if not (is_owner or is_requestor):
        raise HTTPException(
            status_code=403,
            detail="You can only review an exchange you took part in.",
        )

    # The reviewee is the OTHER party, and the two role strings come out of
    # this one place so no endpoint can compute them differently. The listing
    # owner and the requestor are never the same member, because the
    # create-claim route blocks an owner from claiming their own listing.
    if is_owner:
        reviewee_id = claim.claimant_id
        acting_role = "listing_owner"
        reviewee_role = "requestor"
    else:
        reviewee_id = listing.owner_id
        acting_role = "requestor"
        reviewee_role = "listing_owner"

    return claim, listing, reviewee_id, acting_role, reviewee_role


def _build_review_response(review: Review) -> ReviewResponse:
    is_disabled = review.disabled_at is not None
    return ReviewResponse(
        id=str(review.id),
        claim_id=str(review.claim_id),
        reviewer_id=str(review.reviewer_id),
        reviewee_id=str(review.reviewee_id),
        reviewee_role=review.reviewee_role,
        rating=review.rating,
        body=review.body,
        created_at=review.created_at,
        updated_at=review.updated_at,
        is_disabled=is_disabled,
    )


# ── Core functions ────────────────────────────────────────────────────────────


def get_review_context(
    claim_uuid: uuid.UUID,
    acting_member: Member,
    session: Session,
) -> ReviewContextResponse:
    _check_member_is_active(acting_member, "view this review")

    claim, listing, reviewee_id, acting_role, _reviewee_role = _load_exchange_for_review(
        claim_uuid, acting_member, session, lock=False
    )

    if claim.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="You can only review a completed exchange.",
        )

    other_party_name = ""
    try:
        other_party = session.scalars(
            select(Member).where(Member.id == reviewee_id)
        ).first()
    except Exception as error:
        logger.error("Review: loading the other party failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not load the review right now. " + DATABASE_GUIDANCE,
        )
    if other_party is not None:
        other_party_name = other_party.name

    # The acting member's own review, if any. Do NOT filter by disabled_at: a
    # disabled review must still be found, so the screen shows it frozen
    # instead of offering an empty form (Rule 3, read side).
    try:
        existing = session.scalars(
            select(Review)
            .where(Review.claim_id == claim_uuid)
            .where(Review.reviewer_id == acting_member.id)
        ).first()
    except Exception as error:
        logger.error("Review: loading the existing review failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not load the review right now. " + DATABASE_GUIDANCE,
        )

    already_reviewed = False
    existing_review = None
    can_edit = False
    if existing is not None:
        already_reviewed = True
        existing_review = _build_review_response(existing)
        if existing_review.is_disabled is False:
            can_edit = True

    return ReviewContextResponse(
        claim_id=str(claim.id),
        listing_id=str(listing.id),
        listing_title=listing.title,
        role=acting_role,
        other_party_id=str(reviewee_id),
        other_party_name=other_party_name,
        completed_at=claim.completed_at,
        already_reviewed=already_reviewed,
        existing_review=existing_review,
        can_edit=can_edit,
    )


def create_review(
    claim_uuid: uuid.UUID,
    payload: CreateReviewPayload,
    acting_member: Member,
    session: Session,
) -> ReviewResponse:
    _check_member_is_active(acting_member, "leave a review")

    # lock=True takes SELECT ... FOR UPDATE on the claim row, so two
    # submissions for the same exchange are serialized from here to the
    # commit and the duplicate check cannot interleave with the insert.
    claim, _listing, reviewee_id, _acting_role, reviewee_role = _load_exchange_for_review(
        claim_uuid, acting_member, session, lock=True
    )

    if claim.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="You can only review a completed exchange.",
        )

    # Duplicate check (Rule 1) and the disabled block (Rule 3). This query
    # must NOT filter out disabled reviews: a disabled review still counts as
    # the member's one review for this exchange, so a member whose review was
    # disabled is stopped here and cannot write a replacement.
    try:
        existing = session.scalars(
            select(Review)
            .where(Review.claim_id == claim_uuid)
            .where(Review.reviewer_id == acting_member.id)
        ).first()
    except Exception as error:
        logger.error("Review: duplicate check failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not save the review right now. " + DATABASE_GUIDANCE,
        )

    if existing is not None:
        if existing.disabled_at is not None:
            # Not the generic duplicate message: the member is told an admin
            # disabled their review, in the same sentence the edit block uses.
            raise HTTPException(status_code=403, detail=DISABLED_REVIEW_MESSAGE)
        raise HTTPException(
            status_code=409,
            detail="You have already reviewed this exchange.",
        )

    # Spaces alone do not count as a written review. The rating is already
    # bounded 1 to 5 by the request schema.
    review_body = payload.body.strip()
    now = datetime.now(timezone.utc)
    new_review = Review(
        claim_id=claim_uuid,
        reviewer_id=acting_member.id,
        reviewee_id=reviewee_id,
        reviewee_role=reviewee_role,
        rating=payload.rating,
        body=review_body,
        created_at=now,
        updated_at=now,
    )

    try:
        session.add(new_review)
        session.flush()
        review_id = new_review.id
        session.commit()
    except IntegrityError:
        # The backstop if two inserts race past the duplicate check above.
        # The uq_review_claim_reviewer constraint lets exactly one in; the
        # loser gets the same 409 as the ordinary duplicate.
        session.rollback()
        logger.info("Review: duplicate insert blocked by the unique constraint.")
        raise HTTPException(
            status_code=409,
            detail="You have already reviewed this exchange.",
        )
    except Exception as error:
        session.rollback()
        logger.error("Review: saving the review failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not save the review right now. " + DATABASE_GUIDANCE,
        )

    return ReviewResponse(
        id=str(review_id),
        claim_id=str(claim_uuid),
        reviewer_id=str(acting_member.id),
        reviewee_id=str(reviewee_id),
        reviewee_role=reviewee_role,
        rating=payload.rating,
        body=review_body,
        created_at=now,
        updated_at=now,
        is_disabled=False,
    )


def edit_review(
    claim_uuid: uuid.UUID,
    payload: EditReviewPayload,
    acting_member: Member,
    session: Session,
) -> ReviewResponse:
    _check_member_is_active(acting_member, "edit a review")

    # The claim lock is taken first, then the review row lock below: the
    # claim-then-review order is this feature's lock discipline, matching the
    # claims-before-listings order the claim routes use.
    claim, _listing, _reviewee_id, _acting_role, _reviewee_role = _load_exchange_for_review(
        claim_uuid, acting_member, session, lock=True
    )

    if claim.status != "completed":
        # A review can only exist on a completed exchange, so this should
        # never fire on real data, but it keeps the endpoint's rules reading
        # the same as the others.
        raise HTTPException(
            status_code=409,
            detail="You can only review a completed exchange.",
        )

    # Only the author edits: the query is scoped to the acting member, so the
    # only row it can ever return is that member's own (Rule 2). The row lock
    # makes the freeze check below safe against a concurrent admin disable:
    # whoever gets the lock first wins, and the loser sees the committed
    # result (Rule 3 under contention).
    try:
        review = session.scalars(
            select(Review)
            .where(Review.claim_id == claim_uuid)
            .where(Review.reviewer_id == acting_member.id)
            .with_for_update()
        ).first()
    except Exception as error:
        logger.error("Review: loading the review to edit failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not save the review right now. " + DATABASE_GUIDANCE,
        )

    if review is None:
        raise HTTPException(
            status_code=404,
            detail="You have not reviewed this exchange yet.",
        )

    # Rule 3 freeze, re-checked on the locked row, so a disable that committed
    # just before this edit cannot be missed. Same sentence as the create
    # block, from the same constant.
    if review.disabled_at is not None:
        raise HTTPException(status_code=403, detail=DISABLED_REVIEW_MESSAGE)

    # Update in place. created_at, disabled_at, and disabled_by are never
    # touched. An update cannot violate the unique constraint, because the
    # (claim_id, reviewer_id) pair is unchanged.
    now = datetime.now(timezone.utc)
    review.rating = payload.rating
    review.body = payload.body.strip()
    review.updated_at = now

    review_id = review.id
    reviewee_id = review.reviewee_id
    reviewee_role = review.reviewee_role
    rating = review.rating
    body = review.body
    created_at = review.created_at

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Review: saving the edit failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Could not save the review right now. " + DATABASE_GUIDANCE,
        )

    return ReviewResponse(
        id=str(review_id),
        claim_id=str(claim_uuid),
        reviewer_id=str(acting_member.id),
        reviewee_id=str(reviewee_id),
        reviewee_role=reviewee_role,
        rating=rating,
        body=body,
        created_at=created_at,
        updated_at=now,
        is_disabled=False,
    )


# ── HTTP routes ───────────────────────────────────────────────────────────────


@router.get("/claims/{claim_id}/review")
def get_review_context_endpoint(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ReviewContextResponse:
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Exchange not found.")
    return get_review_context(claim_uuid, current_member, session)


@router.post("/claims/{claim_id}/reviews", status_code=201)
def create_review_endpoint(
    claim_id: str,
    payload: CreateReviewPayload,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ReviewResponse:
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Exchange not found.")
    return create_review(claim_uuid, payload, current_member, session)


@router.patch("/claims/{claim_id}/review")
def edit_review_endpoint(
    claim_id: str,
    payload: EditReviewPayload,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ReviewResponse:
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Exchange not found.")
    return edit_review(claim_uuid, payload, current_member, session)
