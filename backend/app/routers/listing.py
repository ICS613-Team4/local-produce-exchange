# Create-listing endpoint. An active member posts a new listing so other
# members can find and request the item. Pydantic validates the body shape
# first; this function then applies the status rule, normalizes and re-checks
# the values, writes the row, and returns the saved listing.
#
# The acting member arrives through the shared get_current_member dependency
# (the X-Member-Id header), the same identity path the invite route uses.

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.listing import CreateListingRequest, ListingResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def normalize_tags(raw_tags):
    # Trim each tag, drop blanks, and remove exact duplicates while keeping the
    # order the poster typed them. The duplicate check is case-sensitive on
    # purpose, so "Vegan" and "vegan" stay two separate tags.
    normalized_tags = []
    for raw_tag in raw_tags:
        trimmed_tag = raw_tag.strip()
        if trimmed_tag == "":
            continue
        if trimmed_tag in normalized_tags:
            continue
        normalized_tags.append(trimmed_tag)
    return normalized_tags


@router.post("/listings", status_code=201)
def create_listing(
    payload: CreateListingRequest,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ListingResponse:
    # Permission gate (Scenario 3, and the "active member" precondition). Only
    # an active member may create a listing. A suspended account gets a
    # suspension-specific message; any other non-active status gets the generic
    # one. Checking != "active" blocks an inactive member too, not just a
    # suspended one.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot create a listing.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot create a listing.",
        )

    # Cache the owner id now, before the commit below expires loaded
    # attributes, so building the response later needs no reload.
    owner_id = current_member.id

    # Validation (Scenario 2). Trim the text fields and reject blanks. The
    # schema already blocks an empty title and description; these also catch the
    # all-spaces case the schema lets through, and category is checked here.
    title = payload.title.strip()
    if title == "":
        raise HTTPException(status_code=422, detail="Title must not be blank.")
    description = payload.description.strip()
    if description == "":
        raise HTTPException(status_code=422, detail="Description must not be blank.")
    category = payload.category.strip()
    if category == "":
        raise HTTPException(status_code=422, detail="Category must not be blank.")

    dietary_tags = normalize_tags(payload.dietary_tags)
    allergen_tags = normalize_tags(payload.allergen_tags)

    # These two duplicate the database check constraints on purpose, so the
    # poster gets a clear message instead of a raw constraint error. The
    # constraints stay the backstop.
    if payload.total_quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity available must be greater than zero.")
    if payload.pickup_end <= payload.pickup_start:
        raise HTTPException(status_code=422, detail="The pickup end time must be after the start time.")

    # Build the pickup window as one range value: the start is included and the
    # end is not. Use SQLAlchemy's own Range so it binds through the TSTZRANGE
    # column.
    pickup_window = Range(payload.pickup_start, payload.pickup_end, bounds="[)")

    # Set created_at in Python so the response has a definite value without a
    # reload. The model still carries a server default for non-ORM inserts.
    created_at = datetime.now(timezone.utc)

    # remaining_quantity starts equal to the quantity available (US-15 note).
    new_listing = Listing(
        owner_id=owner_id,
        title=title,
        description=description,
        category=category,
        dietary_tags=dietary_tags,
        allergen_tags=allergen_tags,
        total_quantity=payload.total_quantity,
        remaining_quantity=payload.total_quantity,
        pickup_window=pickup_window,
        status="active",
        deactivated_by=None,
        created_at=created_at,
    )

    try:
        session.add(new_listing)
        # flush sends the INSERT now so the generated id is known. Cache it
        # before commit, because commit expires loaded attributes and reading
        # the id afterward would trigger an avoidable reload.
        session.flush()
        new_listing_id = new_listing.id
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Creating a listing failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not create a listing right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    # Build the response from the values in hand: the cached ids as strings, the
    # trimmed text (what was actually saved), the normalized tag lists, the
    # created_at built above, and the validated request pickup times.
    return ListingResponse(
        id=str(new_listing_id),
        owner_id=str(owner_id),
        title=title,
        description=description,
        category=category,
        total_quantity=payload.total_quantity,
        remaining_quantity=payload.total_quantity,
        dietary_tags=dietary_tags,
        allergen_tags=allergen_tags,
        pickup_start=payload.pickup_start,
        pickup_end=payload.pickup_end,
        status="active",
        created_at=created_at,
    )
