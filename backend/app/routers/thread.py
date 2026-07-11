# Exchange thread endpoints: read and send messages for a claim's private thread.
#
# Split into pure cores and thin HTTP routes (same pattern as members.py):
#   - get_thread_for_claim() and send_message_to_thread() are the testable cores.
#   - get_thread_endpoint() and send_message_endpoint() are the HTTP wrappers.
#
# The thread is created lazily on first access (GET or POST). Both parties —
# the listing owner and the claimant — may read and write; everyone else gets 403.

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
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.models.thread import Message, MessageThread
from app.schemas.listing import ListingPhotoRef
from app.schemas.thread import MessageResponse, SendMessagePayload, ThreadResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _load_claim_and_check_party(
    claim_id: uuid.UUID,
    acting_member: Member,
    session: Session,
) -> tuple[Claim, Listing]:
    """Load the claim and its listing, then verify the acting member is a party.

    Returns (claim, listing) on success. Raises HTTPException otherwise.
    """
    try:
        claim = session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    except Exception as error:
        logger.error("Thread: loading claim failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the exchange right now.")

    if claim is None:
        raise HTTPException(status_code=404, detail="Exchange not found.")

    try:
        listing = session.scalars(
            select(Listing).where(Listing.id == claim.listing_id)
        ).first()
    except Exception as error:
        logger.error("Thread: loading listing failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the exchange right now.")

    if listing is None:
        raise HTTPException(status_code=404, detail="Exchange not found.")

    is_owner = listing.owner_id == acting_member.id
    is_claimant = claim.claimant_id == acting_member.id
    if not (is_owner or is_claimant):
        raise HTTPException(
            status_code=403,
            detail="You are not a party to this exchange.",
        )

    return claim, listing


def _get_or_create_thread(
    claim_id: uuid.UUID,
    session: Session,
) -> MessageThread:
    """Return the existing thread for this claim, or create one if it doesn't exist yet.

    Uses an INSERT … then re-fetch on IntegrityError to handle the rare race where
    two requests try to create the thread at the same moment.
    """
    try:
        thread = session.scalars(
            select(MessageThread).where(MessageThread.claim_id == claim_id)
        ).first()
    except Exception as error:
        logger.error("Thread: fetching thread failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the thread right now.")

    if thread is not None:
        return thread

    new_thread = MessageThread(claim_id=claim_id, created_at=datetime.now(timezone.utc))
    try:
        session.add(new_thread)
        session.flush()
    except IntegrityError:
        # Another request created the thread between our SELECT and INSERT.
        session.rollback()
        try:
            thread = session.scalars(
                select(MessageThread).where(MessageThread.claim_id == claim_id)
            ).first()
        except Exception as error:
            logger.error("Thread: re-fetch after race failed: %s", error)
            raise HTTPException(status_code=503, detail="Could not load the thread right now.")
        if thread is None:
            raise HTTPException(status_code=503, detail="Could not load the thread right now.")
        return thread
    except Exception as error:
        session.rollback()
        logger.error("Thread: creating thread failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not create the thread right now.")

    return new_thread


def _load_messages(thread_id: uuid.UUID, session: Session) -> list[MessageResponse]:
    """Load all messages for a thread oldest-first, joining sender name."""
    try:
        rows = session.scalars(
            select(Message)
            .where(Message.thread_id == thread_id)
            .order_by(Message.sent_at.asc(), Message.id.asc())
        ).all()
    except Exception as error:
        logger.error("Thread: loading messages failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load messages right now.")

    if not rows:
        return []

    sender_ids = {m.sender_id for m in rows}
    try:
        sender_rows = session.scalars(
            select(Member).where(Member.id.in_(sender_ids))
        ).all()
    except Exception as error:
        logger.error("Thread: loading senders failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load messages right now.")

    sender_names: dict[uuid.UUID, str] = {m.id: m.name for m in sender_rows}

    return [
        MessageResponse(
            id=str(m.id),
            thread_id=str(m.thread_id),
            sender_id=str(m.sender_id),
            sender_name=sender_names.get(m.sender_id, "Unknown"),
            body=m.body,
            sent_at=m.sent_at,
        )
        for m in rows
    ]


# ── Core functions ────────────────────────────────────────────────────────────


def get_thread_for_claim(
    claim_id: uuid.UUID,
    acting_member: Member,
    session: Session,
) -> ThreadResponse:
    claim, listing = _load_claim_and_check_party(claim_id, acting_member, session)
    thread = _get_or_create_thread(claim_id, session)

    try:
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Thread: commit failed on get: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the thread right now.")

    messages = _load_messages(thread.id, session)

    # The two parties' names, so the page can show who posted the listing and
    # who requested the items. A lookup failure or a missing member just
    # leaves that name empty, the same as the listing detail response.
    owner_name = ""
    try:
        owner_row = session.scalars(
            select(Member).where(Member.id == listing.owner_id)
        ).first()
        if owner_row is not None:
            owner_name = owner_row.name
    except Exception as error:
        logger.error("Thread: loading the listing owner failed: %s", error)
    claimant_name = ""
    try:
        claimant_row = session.scalars(
            select(Member).where(Member.id == claim.claimant_id)
        ).first()
        if claimant_row is not None:
            claimant_name = claimant_row.name
    except Exception as error:
        logger.error("Thread: loading the claimant failed: %s", error)

    # The listing's photos, ordered for display, so the page can show the
    # cover photo.
    try:
        photo_rows = session.scalars(
            select(ListingPhoto)
            .where(ListingPhoto.listing_id == listing.id)
            .order_by(ListingPhoto.position)
        ).all()
    except Exception as error:
        logger.error("Thread: loading listing photos failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the exchange right now.")
    photos = []
    for photo_row in photo_rows:
        photos.append(
            ListingPhotoRef(
                id=str(photo_row.id),
                content_type=photo_row.content_type,
                position=photo_row.position,
            )
        )

    # The pickup window, read with the same None guards the listing routes
    # use; a malformed range just leaves both ends unset.
    pickup_start = None
    pickup_end = None
    if listing.pickup_window is not None:
        pickup_start = listing.pickup_window.lower
        pickup_end = listing.pickup_window.upper

    return ThreadResponse(
        id=str(thread.id),
        claim_id=str(thread.claim_id),
        created_at=thread.created_at,
        messages=messages,
        listing_id=str(listing.id),
        listing_title=listing.title,
        owner_id=str(listing.owner_id),
        claimant_id=str(claim.claimant_id),
        owner_name=owner_name,
        claimant_name=claimant_name,
        listing_created_at=listing.created_at,
        pickup_start=pickup_start,
        pickup_end=pickup_end,
        requested_quantity=claim.requested_quantity,
        approved_quantity=claim.approved_quantity,
        photos=photos,
    )


def send_message_to_thread(
    claim_id: uuid.UUID,
    payload: SendMessagePayload,
    acting_member: Member,
    session: Session,
) -> MessageResponse:
    _load_claim_and_check_party(claim_id, acting_member, session)
    thread = _get_or_create_thread(claim_id, session)

    sent_at = datetime.now(timezone.utc)
    new_message = Message(
        thread_id=thread.id,
        sender_id=acting_member.id,
        body=payload.body.strip(),
        sent_at=sent_at,
    )

    # body.strip() could technically empty a body that Pydantic passed (e.g. a
    # single space). Reject it here with the same 422 the schema uses for empty.
    if not new_message.body:
        raise HTTPException(status_code=422, detail="Message body must not be blank.")

    try:
        session.add(new_message)
        session.flush()
        message_id = new_message.id
        session.commit()
    except Exception as error:
        session.rollback()
        logger.error("Thread: saving message failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not send the message right now.")

    return MessageResponse(
        id=str(message_id),
        thread_id=str(thread.id),
        sender_id=str(acting_member.id),
        sender_name=acting_member.name,
        body=new_message.body,
        sent_at=sent_at,
    )


# ── HTTP routes ───────────────────────────────────────────────────────────────


@router.get("/claims/{claim_id}/thread")
def get_thread_endpoint(
    claim_id: str,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> ThreadResponse:
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Exchange not found.")
    return get_thread_for_claim(claim_uuid, current_member, session)


@router.post("/claims/{claim_id}/thread/messages", status_code=201)
def send_message_endpoint(
    claim_id: str,
    payload: SendMessagePayload,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> MessageResponse:
    try:
        claim_uuid = uuid.UUID(claim_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Exchange not found.")
    return send_message_to_thread(claim_uuid, payload, current_member, session)
