# Create-listing endpoint. An active member posts a new listing so other
# members can find and request the item. Pydantic validates the body shape
# first; this function then applies the status rule, normalizes and re-checks
# the values, writes the row, and returns the saved listing.
#
# The acting member arrives through the shared get_current_member dependency
# (the X-Member-Id header), the same identity path the invite route uses.

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
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


@router.get("/listings/{listing_id}")
def get_listing(
    listing_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ListingResponse:
    # Permission gate. UC-07 expects a logged-in, active member. A suspended
    # account cannot take any member action, and the insecure X-Member-Id
    # header means a forged suspended id could otherwise read details, so this
    # route applies the same active-member check the create-listing route uses.
    # The wording is about viewing, not creating, so the message is truthful
    # for this endpoint.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot view listings.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot view listings.",
        )

    # The id arrives as a path string. A value that is not a real UUID cannot
    # match any listing, so treat it as not found rather than a server error.
    # One not-found message covers the missing, malformed, and inactive cases.
    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Look the row up by id. Wrap the query so a down or unmigrated database
    # returns 503 instead of an unhandled error, matching the create path.
    try:
        row = session.scalars(select(Listing).where(Listing.id == listing_uuid)).first()
    except Exception as error:
        logger.error("Reading a listing failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    # No such listing.
    if row is None:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # The listing exists but is no longer active (Scenario 2). Any non-active
    # status (claimed, expired, cancelled, deactivated) shows as unavailable.
    if row.status != "active":
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Read the pickup window back off the stored range. Check each piece before
    # reading the next, so nothing is read off a missing value. The column is
    # NOT NULL, so a missing window should not happen, but a manual row could
    # hold an unbounded or equal-bound range that ListingResponse cannot
    # represent; treat any of those as unavailable, reusing the same message.
    pickup_window = row.pickup_window
    if pickup_window is None:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")
    pickup_start = pickup_window.lower
    pickup_end = pickup_window.upper
    if pickup_start is None or pickup_end is None:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")
    if pickup_end <= pickup_start:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # The model lets description and category be NULL, but ListingResponse types
    # both as plain strings. Coerce a null to an empty string so a null row
    # never crashes building the response.
    description = row.description
    if description is None:
        description = ""
    category = row.category
    if category is None:
        category = ""

    # Build the response from the stored row: the ids as strings (same as the
    # create response), the coerced text, the tag lists, the two pickup times
    # pulled from the range above, and the status and created_at.
    return ListingResponse(
        id=str(row.id),
        owner_id=str(row.owner_id),
        title=row.title,
        description=description,
        category=category,
        total_quantity=row.total_quantity,
        remaining_quantity=row.remaining_quantity,
        dietary_tags=row.dietary_tags,
        allergen_tags=row.allergen_tags,
        pickup_start=pickup_start,
        pickup_end=pickup_end,
        status=row.status,
        created_at=row.created_at,
    )


@router.put("/listings/{listing_id}")
def edit_listing(
    listing_id: str,
    payload: CreateListingRequest,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ListingResponse:
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot edit a listing.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot edit a listing.",
        )

    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    try:
        row = session.scalars(select(Listing).where(Listing.id == listing_uuid)).first()
    except Exception as error:
        logger.error("Reading a listing for edit failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if row is None:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    if row.owner_id != current_member.id:
        raise HTTPException(status_code=403, detail="You can only edit your own listing.")

    if row.status != "active":
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

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

    if payload.total_quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity available must be greater than zero.")
    if payload.pickup_end <= payload.pickup_start:
        raise HTTPException(status_code=422, detail="The pickup end time must be after the start time.")

    approved_quantity = row.total_quantity - row.remaining_quantity
    if payload.total_quantity < approved_quantity:
        raise HTTPException(
            status_code=422,
            detail=(
                "The quantity available cannot be less than the amount already "
                f"approved ({approved_quantity})."
            ),
        )
    new_remaining_quantity = payload.total_quantity - approved_quantity

    row.title = title
    row.description = description
    row.category = category
    row.dietary_tags = dietary_tags
    row.allergen_tags = allergen_tags
    row.total_quantity = payload.total_quantity
    row.remaining_quantity = new_remaining_quantity
    row.pickup_window = Range(payload.pickup_start, payload.pickup_end, bounds="[)")

    listing_id_out = row.id
    owner_id_out = row.owner_id
    status_out = row.status
    created_at_out = row.created_at
    total_quantity_out = row.total_quantity
    remaining_quantity_out = row.remaining_quantity

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Editing a listing failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not save your changes right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ListingResponse(
        id=str(listing_id_out),
        owner_id=str(owner_id_out),
        title=title,
        description=description,
        category=category,
        total_quantity=total_quantity_out,
        remaining_quantity=remaining_quantity_out,
        dietary_tags=dietary_tags,
        allergen_tags=allergen_tags,
        pickup_start=payload.pickup_start,
        pickup_end=payload.pickup_end,
        status=status_out,
        created_at=created_at_out,
    )
