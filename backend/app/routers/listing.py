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
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.models.review import Review
from app.schemas.listing import CreateListingRequest, ListingPhotoRef, ListingResponse

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


def load_photo_refs(session, listing_id):
    rows = session.scalars(
        select(ListingPhoto)
        .where(ListingPhoto.listing_id == listing_id)
        .order_by(ListingPhoto.position)
    ).all()
    refs = []
    for row in rows:
        refs.append(
            ListingPhotoRef(
                id=str(row.id),
                content_type=row.content_type,
                position=row.position,
            )
        )
    return refs


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


@router.get("/listings")
def browse_listings(
    q: Annotated[str | None, Query()] = None,
    category: Annotated[str | None, Query()] = None,
    dietary_tags: Annotated[list[str] | None, Query()] = None,
    allergen_tags: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> list[ListingResponse]:
    # Browse, search, and filter active listings (US-06 / UC-06). A logged-in,
    # active member sends optional search text and filters; the route returns the
    # active listings that match, newest first.

    # Permission gate. Same active-member rule and exact messages as get_listing:
    # the insecure X-Member-Id header means a forged suspended id could otherwise
    # read listings, so a non-active acting member is denied.
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

    # Build the query one piece at a time. Start from active-only (the browse-side
    # half of US-17/US-27: a deactivated listing must not appear), then add each
    # filter the caller actually sent. A filter left out does not narrow the
    # results. All the filters are ANDed together.
    statement = select(Listing).where(Listing.status == "active")
    if q is not None and q.strip() != "":
        # Search text matches the title or the description, case-insensitive.
        pattern = "%" + q.strip() + "%"
        statement = statement.where(
            or_(Listing.title.ilike(pattern), Listing.description.ilike(pattern))
        )
    if category is not None and category.strip() != "":
        statement = statement.where(Listing.category == category.strip())
    if dietary_tags:
        # .contains([...]) emits the GIN-indexed Postgres @> operator: keep a row
        # only when its dietary tags include every selected tag.
        statement = statement.where(Listing.dietary_tags.contains(dietary_tags))
    if allergen_tags:
        statement = statement.where(Listing.allergen_tags.contains(allergen_tags))
    # Order newest first, with the id as a tiebreaker so the order is total and
    # deterministic. Without the tiebreaker, listings that share a created_at
    # (seed rows all get the same now() inside one transaction) sort in an
    # arbitrary order, and with LIMIT that means an unrelated UPDATE on one row
    # could shuffle which rows fall in the window. The unique id breaks every tie
    # the same way every time.
    statement = statement.order_by(Listing.created_at.desc(), Listing.id.desc()).limit(limit)

    # Wrap the read so a down or unmigrated database returns 503 instead of an
    # unhandled error, matching the other listing routes.
    try:
        rows = session.scalars(statement).all()
        listing_ids = []
        for row in rows:
            listing_ids.append(row.id)
        photos_by_listing = {}
        if listing_ids:
            photo_rows = session.scalars(
                select(ListingPhoto)
                .where(ListingPhoto.listing_id.in_(listing_ids))
                .order_by(ListingPhoto.position)
            ).all()
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
        # Load every owner's name in one query, so each card can show who
        # posted the listing. Same batching as the photos above.
        owner_ids = []
        for row in rows:
            if row.owner_id not in owner_ids:
                owner_ids.append(row.owner_id)
        owner_names_by_id = {}
        if owner_ids:
            owner_rows = session.scalars(
                select(Member).where(Member.id.in_(owner_ids))
            ).all()
            for owner_row in owner_rows:
                owner_names_by_id[owner_row.id] = owner_row.name
        # Load every owner's listing-owner reputation in one query (US-20):
        # the average rating and review count across reviews where the owner
        # was reviewed AS a listing owner. Reviews an admin disabled are left
        # out. An owner with no reviews simply has no entry here.
        owner_ratings_by_id = {}
        if owner_ids:
            rating_rows = session.execute(
                select(
                    Review.reviewee_id,
                    func.avg(Review.rating),
                    func.count(Review.id),
                )
                .where(Review.reviewee_id.in_(owner_ids))
                .where(Review.reviewee_role == "listing_owner")
                .where(Review.disabled_at.is_(None))
                .group_by(Review.reviewee_id)
            ).all()
            for rating_row in rating_rows:
                rating_entry = {}
                rating_entry["average"] = float(rating_row[1])
                rating_entry["count"] = int(rating_row[2])
                owner_ratings_by_id[rating_row[0]] = rating_entry
    except Exception as error:
        logger.error("Browsing listings failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read listings right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    # Turn each row into a response item, reusing get_listing's guards. Skip a
    # row whose pickup window is missing, unbounded, or equal-bound (ListingResponse
    # cannot represent it) rather than failing the whole list, and coerce a null
    # description or category to an empty string.
    results = []
    for row in rows:
        pickup_window = row.pickup_window
        if pickup_window is None:
            continue
        pickup_start = pickup_window.lower
        pickup_end = pickup_window.upper
        if pickup_start is None or pickup_end is None:
            continue
        if pickup_end <= pickup_start:
            continue
        description = row.description
        if description is None:
            description = ""
        category_value = row.category
        if category_value is None:
            category_value = ""
        photos = photos_by_listing.get(row.id, [])
        owner_rating_average = None
        owner_rating_count = 0
        if row.owner_id in owner_ratings_by_id:
            owner_rating_average = owner_ratings_by_id[row.owner_id]["average"]
            owner_rating_count = owner_ratings_by_id[row.owner_id]["count"]
        results.append(
            ListingResponse(
                id=str(row.id),
                owner_id=str(row.owner_id),
                title=row.title,
                description=description,
                category=category_value,
                total_quantity=row.total_quantity,
                remaining_quantity=row.remaining_quantity,
                dietary_tags=row.dietary_tags,
                allergen_tags=row.allergen_tags,
                pickup_start=pickup_start,
                pickup_end=pickup_end,
                status=row.status,
                created_at=row.created_at,
                owner_name=owner_names_by_id.get(row.owner_id, ""),
                photos=photos,
                owner_rating_average=owner_rating_average,
                owner_rating_count=owner_rating_count,
            )
        )
    return results


@router.get("/my-listings")
def get_my_listings(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> list[ListingResponse]:
    # The caller's own listings, active and deactivated, newest first (US-24).
    # This mirrors browse_listings but drops the active-only filter and the search
    # filters, scopes to the caller's own rows, and adds deactivated_by so the
    # page can tell an admin takedown apart from an owner one.
    #
    # The path is /my-listings, not /listings/mine, so it never collides with the
    # GET /listings/{listing_id} dynamic route. This matches the /my-requests
    # convention in claim.py.

    # Permission gate. Same active-member rule and exact messages as
    # browse_listings: the insecure X-Member-Id header means a forged suspended id
    # could otherwise read listings, so a non-active acting member is denied.
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

    # Every listing the caller owns, any status, newest first. The id is a
    # tiebreaker so rows that share a created_at sort in a stable, repeatable
    # order, the same rule browse_listings uses.
    statement = (
        select(Listing)
        .where(Listing.owner_id == current_member.id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )

    # Wrap the read so a down or unmigrated database returns 503 instead of an
    # unhandled error, matching the other listing routes.
    try:
        rows = session.scalars(statement).all()
        listing_ids = []
        for row in rows:
            listing_ids.append(row.id)
        photos_by_listing = {}
        if listing_ids:
            photo_rows = session.scalars(
                select(ListingPhoto)
                .where(ListingPhoto.listing_id.in_(listing_ids))
                .order_by(ListingPhoto.position)
            ).all()
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
    except Exception as error:
        logger.error("Loading your listings failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read your listings right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    # Turn each row into a response item, reusing browse_listings' guards. Skip a
    # row whose pickup window is missing, unbounded, or equal-bound, and coerce a
    # null description or category to an empty string. The one field this loop
    # adds beyond the browse loop is deactivated_by, set to the admin id as a
    # string when present so the page can show "Administratively deactivated".
    # Real owner rows always have a valid pickup window because create enforces
    # it, so the defensive skip will not drop a member's own listing in practice.
    results = []
    for row in rows:
        pickup_window = row.pickup_window
        if pickup_window is None:
            continue
        pickup_start = pickup_window.lower
        pickup_end = pickup_window.upper
        if pickup_start is None or pickup_end is None:
            continue
        if pickup_end <= pickup_start:
            continue
        description = row.description
        if description is None:
            description = ""
        category_value = row.category
        if category_value is None:
            category_value = ""
        deactivated_by_value = None
        if row.deactivated_by is not None:
            deactivated_by_value = str(row.deactivated_by)
        photos = photos_by_listing.get(row.id, [])
        results.append(
            ListingResponse(
                id=str(row.id),
                owner_id=str(row.owner_id),
                title=row.title,
                description=description,
                category=category_value,
                total_quantity=row.total_quantity,
                remaining_quantity=row.remaining_quantity,
                dietary_tags=row.dietary_tags,
                allergen_tags=row.allergen_tags,
                pickup_start=pickup_start,
                pickup_end=pickup_end,
                status=row.status,
                created_at=row.created_at,
                deactivated_by=deactivated_by_value,
                photos=photos,
            )
        )
    return results


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

    # Look up the owner's name so the page can show "Posted by <name>". A
    # lookup failure or a missing member just leaves the name empty; the
    # listing itself still loads.
    owner_name = ""
    try:
        owner_row = session.scalars(select(Member).where(Member.id == row.owner_id)).first()
        if owner_row is not None:
            owner_name = owner_row.name
    except Exception as error:
        logger.error("Reading the listing owner failed: %s", error)

    # The owner's listing-owner reputation (US-20): the average rating and the
    # review count across reviews where the owner was reviewed AS a listing
    # owner. Reviews an admin disabled are left out. No reviews means the
    # average stays None and the count 0, which the page shows as
    # "No rating yet".
    owner_rating_average = None
    owner_rating_count = 0
    try:
        rating_row = session.execute(
            select(func.avg(Review.rating), func.count(Review.id))
            .where(Review.reviewee_id == row.owner_id)
            .where(Review.reviewee_role == "listing_owner")
            .where(Review.disabled_at.is_(None))
        ).first()
    except Exception as error:
        logger.error("Reading the owner's rating failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )
    if rating_row is not None and rating_row[0] is not None:
        owner_rating_average = float(rating_row[0])
        owner_rating_count = int(rating_row[1])

    try:
        photos = load_photo_refs(session, row.id)
    except Exception as error:
        logger.error("Reading listing photos failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

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
        owner_name=owner_name,
        photos=photos,
        owner_rating_average=owner_rating_average,
        owner_rating_count=owner_rating_count,
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

    try:
        photos = load_photo_refs(session, listing_id_out)
    except Exception as error:
        logger.error("Reading listing photos after edit failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
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
        photos=photos,
    )


@router.post("/listings/{listing_id}/deactivate", status_code=204)
def deactivate_listing(
    listing_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> None:
    # The owner takes their own active listing out of circulation. Deactivation
    # blocks NEW requests (create_claim treats a non-active listing as not
    # found) and cancels the still-pending ones below, but exchanges that were
    # already approved, picked up, or completed carry on: their endpoints do
    # not check the listing status, and the all-requests page keeps showing a
    # deactivated listing while it still has requests. This endpoint never
    # touches deactivated_by, which stays the admin-only signal (US-27). The
    # checks run in the same order as edit_listing so the two endpoints behave
    # the same way.

    # Active-member gate. A suspended account gets a suspension-specific message;
    # any other non-active status gets the generic one. This runs before the
    # ownership check, so even the owner is blocked while suspended.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot deactivate a listing.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot deactivate a listing.",
        )

    # A value that is not a real UUID cannot match any listing, so treat it as
    # not found rather than a server error.
    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Load the row. A down or unmigrated database returns 503, matching the other
    # endpoints.
    try:
        row = session.scalars(select(Listing).where(Listing.id == listing_uuid)).first()
    except Exception as error:
        logger.error("Reading a listing for deactivate failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if row is None:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Ownership gate (Scenario 2). A member can only deactivate their own
    # listing; another member's listing stays active.
    if row.owner_id != current_member.id:
        raise HTTPException(status_code=403, detail="You can only deactivate your own listing.")

    # Only an active listing can be deactivated. Any non-active status reads as
    # unavailable, the same as edit treats it.
    if row.status != "active":
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Cancel the listing's still-pending requests in the same transaction, so
    # the recipients' requests do not sit waiting forever on a listing that can
    # no longer be approved. Only "requested" claims change; approved, picked
    # up, completed, denied, and already-cancelled ones are left alone. The
    # claim rows are locked first (claims before listings, the fixed lock order
    # the claim router uses), so a concurrent approval of the same claim cannot
    # interleave with this cancellation. No quantity moves: quantity only
    # leaves a listing at approval, and these claims were never approved.
    now = datetime.now(timezone.utc)
    try:
        pending_claims = session.scalars(
            select(Claim)
            .where(Claim.listing_id == row.id)
            .where(Claim.status == "requested")
            .with_for_update()
        ).all()
    except Exception as error:
        logger.error("Loading pending claims for deactivate failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not deactivate the listing right now. "
                "Make sure the database is running and migrated."
            ),
        )
    for pending_claim in pending_claims:
        pending_claim.status = "cancelled"
        pending_claim.cancelled_at = now

    # The listing state change. Leave deactivated_by null on purpose.
    row.status = "deactivated"

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Deactivating a listing failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not deactivate the listing right now. "
                "Make sure the database is running and migrated."
            ),
        )

    # FastAPI sends 204 with an empty body given status_code=204.
    return None


@router.post("/listings/{listing_id}/reactivate", status_code=204)
def reactivate_listing(
    listing_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> None:
    # The owner turns their own deactivated listing back on. This is the inverse
    # of deactivate_listing: it flips status from "deactivated" back to "active".
    # It refuses a listing an admin took down (deactivated_by is set), because
    # only an admin can undo an admin deactivation (US-32). The checks run in the
    # same order as deactivate_listing so the two endpoints behave the same way.

    # Active-member gate. A suspended account gets a suspension-specific message;
    # any other non-active status gets the generic one. This runs before the
    # ownership check, so even the owner is blocked while suspended.
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot reactivate a listing.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot reactivate a listing.",
        )

    # A value that is not a real UUID cannot match any listing, so treat it as
    # not found rather than a server error.
    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Load the row. A down or unmigrated database returns 503, matching the other
    # endpoints.
    try:
        row = session.scalars(select(Listing).where(Listing.id == listing_uuid)).first()
    except Exception as error:
        logger.error("Reading a listing for reactivate failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if row is None:
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    # Ownership gate (Scenario 3). A member can only reactivate their own listing;
    # another member's listing stays unchanged.
    if row.owner_id != current_member.id:
        raise HTTPException(status_code=403, detail="You can only reactivate your own listing.")

    # Workflow gate (Scenario 4). An already-active listing has nothing to
    # reactivate.
    if row.status == "active":
        raise HTTPException(status_code=409, detail="This listing is already active.")

    # Only a deactivated listing can be reactivated. A claimed, expired, or
    # cancelled listing is not a reactivation target.
    if row.status != "deactivated":
        raise HTTPException(status_code=409, detail="Only a deactivated listing can be reactivated.")

    # Permission gate (Scenario 2). A set deactivated_by means an admin took the
    # listing down. Only an admin can undo that (US-32), so the owner is denied
    # and the listing stays deactivated.
    if row.deactivated_by is not None:
        raise HTTPException(
            status_code=403,
            detail="An administrator deactivated this listing, so you cannot reactivate it.",
        )

    # The one state change this story owns. The listing was owner-deactivated, so
    # deactivated_by is already null and stays null.
    row.status = "active"

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Reactivating a listing failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reactivate the listing right now. "
                "Make sure the database is running and migrated."
            ),
        )

    # FastAPI sends 204 with an empty body given status_code=204.
    return None
