import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.schemas.listing import ListingPhotoRef

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_PHOTO_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_PHOTO_BYTES = 2 * 1024 * 1024
MAX_PHOTOS_PER_LISTING = 3


def load_owned_active_listing(session, listing_id, current_member):
    try:
        listing_uuid = uuid.UUID(listing_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    try:
        row = session.scalars(select(Listing).where(Listing.id == listing_uuid)).first()
    except Exception as error:
        logger.error("Reading a listing for a photo change failed: %s", error)
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
        raise HTTPException(
            status_code=403,
            detail="You can only change photos on your own listing.",
        )
    if row.status != "active":
        raise HTTPException(status_code=404, detail="This listing is unavailable.")

    return listing_uuid


@router.post("/listings/{listing_id}/photos", status_code=201)
def upload_listing_photo(
    listing_id: str,
    file: UploadFile,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ListingPhotoRef:
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot add a photo.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot add a photo.",
        )

    listing_uuid = load_owned_active_listing(session, listing_id, current_member)

    if file.content_type not in ALLOWED_PHOTO_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=(
                "That file type is not allowed. "
                "Please upload a JPEG, PNG, or WebP image."
            ),
        )

    image_bytes = file.file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=422, detail="That file is empty.")
    if len(image_bytes) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="That file is too large. The maximum size is 2 MB.",
        )

    try:
        existing = session.scalars(
            select(ListingPhoto)
            .where(ListingPhoto.listing_id == listing_uuid)
            .order_by(ListingPhoto.position)
        ).all()
    except Exception as error:
        logger.error("Reading listing photos failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the listing photos right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if len(existing) >= MAX_PHOTOS_PER_LISTING:
        raise HTTPException(
            status_code=422,
            detail="This listing already has the most photos allowed (3).",
        )

    next_position = 0
    if existing:
        next_position = existing[-1].position + 1

    new_photo = ListingPhoto(
        listing_id=listing_uuid,
        content_type=file.content_type,
        image_bytes=image_bytes,
        position=next_position,
    )
    try:
        session.add(new_photo)
        session.flush()
        new_photo_id = new_photo.id
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Saving a listing photo failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not save the photo right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return ListingPhotoRef(
        id=str(new_photo_id),
        content_type=file.content_type,
        position=next_position,
    )


@router.delete("/listings/{listing_id}/photos/{photo_id}", status_code=204)
def delete_listing_photo(
    listing_id: str,
    photo_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> None:
    if current_member.status != "active":
        if current_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot remove a photo.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot remove a photo.",
        )

    try:
        photo_uuid = uuid.UUID(photo_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="That photo was not found.")

    listing_uuid = load_owned_active_listing(session, listing_id, current_member)

    try:
        photo_row = session.scalars(
            select(ListingPhoto)
            .where(ListingPhoto.id == photo_uuid)
            .where(ListingPhoto.listing_id == listing_uuid)
        ).first()
    except Exception as error:
        logger.error("Reading a listing photo for removal failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the photo right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if photo_row is None:
        raise HTTPException(status_code=404, detail="That photo was not found.")

    try:
        session.delete(photo_row)
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Removing a listing photo failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not remove the photo right now. "
                "Make sure the database is running and migrated."
            ),
        )

    return None


@router.get("/photos/{photo_id}")
def serve_listing_photo(
    photo_id: str,
    session: Session = Depends(get_db_session),
) -> Response:
    try:
        photo_uuid = uuid.UUID(photo_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="That photo was not found.")

    try:
        row = session.scalars(
            select(ListingPhoto).where(ListingPhoto.id == photo_uuid)
        ).first()
    except Exception as error:
        logger.error("Reading a listing photo failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the photo right now. "
                "Make sure the database is running and migrated."
            ),
        )

    if row is None:
        raise HTTPException(status_code=404, detail="That photo was not found.")

    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    return Response(
        content=row.image_bytes,
        media_type=row.content_type,
        headers=headers,
    )
