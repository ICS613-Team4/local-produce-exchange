# Tests for the exchange thread endpoints (US-14).
# Run from the project root with: npm run test:backend
#
# The core tests call get_thread_for_claim() and send_message_to_thread()
# directly with real DB sessions, covering logic without the HTTP layer.
# Route-layer tests call the endpoint functions directly with injected deps.

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.models.notification import Notification
from app.models.thread import Message
from app.routers.thread import (
    get_thread_endpoint,
    get_thread_for_claim,
    send_message_endpoint,
    send_message_to_thread,
)
from app.schemas.thread import SendMessagePayload


# ── helpers ──────────────────────────────────────────────────────────────────


def insert_member(session, email="alice@example.com", name="Alice"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status="active",
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status="active",
    )
    session.add(listing)
    session.commit()
    return listing


def insert_claim(session, listing, claimant, status="approved"):
    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=2,
        approved_quantity=2 if status == "approved" else None,
        status=status,
        requested_at=datetime.now(timezone.utc),
    )
    session.add(claim)
    session.commit()
    return claim


# ── Scenario 1: get thread creates it on first call ──────────────────────────


def test_get_thread_creates_thread_for_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    result = get_thread_for_claim(claim.id, owner, db_session)

    assert result.claim_id == str(claim.id)
    assert result.messages == []


def test_get_thread_carries_the_listing_and_claim_details(db_session):
    # The thread response names the listing (title, owner, posted time, pickup
    # window, photos) and the claim's quantities, so the page can show what
    # the exchange is about without another fetch.
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    photo = ListingPhoto(
        listing_id=listing.id,
        content_type="image/png",
        image_bytes=b"png-bytes",
        position=0,
    )
    db_session.add(photo)
    db_session.commit()
    claim = insert_claim(db_session, listing, claimant)

    result = get_thread_for_claim(claim.id, claimant, db_session)

    assert result.listing_id == str(listing.id)
    assert result.listing_title == "Fresh Tomatoes"
    assert result.owner_id == str(owner.id)
    assert result.claimant_id == str(claimant.id)
    assert result.owner_name == "Owner"
    assert result.claimant_name == "Claimant"
    assert result.listing_created_at is not None
    assert result.pickup_start == datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    assert result.pickup_end == datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    assert result.requested_quantity == 2
    assert result.approved_quantity == 2
    assert len(result.photos) == 1
    assert result.photos[0].id == str(photo.id)
    assert result.photos[0].content_type == "image/png"


def test_get_thread_creates_thread_for_claimant(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    result = get_thread_for_claim(claim.id, claimant, db_session)

    assert result.claim_id == str(claim.id)
    assert result.messages == []


def test_get_thread_is_idempotent(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    first = get_thread_for_claim(claim.id, owner, db_session)
    second = get_thread_for_claim(claim.id, claimant, db_session)

    assert first.id == second.id


# ── Scenario 1: send and read messages ───────────────────────────────────────


def test_send_message_appears_in_thread(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)
    payload = SendMessagePayload(body="I'll be there at 9am.")

    response = send_message_to_thread(claim.id, payload, owner, db_session)

    assert response.body == "I'll be there at 9am."
    assert response.sender_id == str(owner.id)
    assert response.sender_name == "Owner"


def test_messages_visible_to_both_parties(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    send_message_to_thread(claim.id, SendMessagePayload(body="Hello!"), owner, db_session)
    send_message_to_thread(claim.id, SendMessagePayload(body="Hi back!"), claimant, db_session)

    thread = get_thread_for_claim(claim.id, claimant, db_session)

    assert len(thread.messages) == 2
    assert thread.messages[0].body == "Hello!"
    assert thread.messages[0].sender_name == "Owner"
    assert thread.messages[1].body == "Hi back!"
    assert thread.messages[1].sender_name == "Claimant"


def test_messages_ordered_oldest_first(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    send_message_to_thread(claim.id, SendMessagePayload(body="First"), owner, db_session)
    send_message_to_thread(claim.id, SendMessagePayload(body="Second"), claimant, db_session)
    send_message_to_thread(claim.id, SendMessagePayload(body="Third"), owner, db_session)

    thread = get_thread_for_claim(claim.id, owner, db_session)

    assert [m.body for m in thread.messages] == ["First", "Second", "Third"]


def test_send_message_strips_surrounding_whitespace(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)
    payload = SendMessagePayload(body="  hello  ")

    response = send_message_to_thread(claim.id, payload, owner, db_session)

    assert response.body == "hello"


# ── Scenario 2: empty message rejected ───────────────────────────────────────


def test_empty_body_rejected_by_schema():
    with pytest.raises(Exception):
        SendMessagePayload(body="")


def test_whitespace_only_body_rejected_by_router(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)
    # A single space passes Pydantic's min_length=1 but the router strips it.
    payload = SendMessagePayload(body=" ")

    with pytest.raises(HTTPException) as exc:
        send_message_to_thread(claim.id, payload, owner, db_session)

    assert exc.value.status_code == 422
    assert "blank" in exc.value.detail.lower()


# ── Scenario 3: non-party denied ─────────────────────────────────────────────


def test_non_party_cannot_get_thread(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    outsider = insert_member(db_session, email="outsider@example.com", name="Outsider")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    with pytest.raises(HTTPException) as exc:
        get_thread_for_claim(claim.id, outsider, db_session)

    assert exc.value.status_code == 403
    assert "not a party" in exc.value.detail.lower()


def test_non_party_cannot_send_message(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    outsider = insert_member(db_session, email="outsider@example.com", name="Outsider")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)
    payload = SendMessagePayload(body="Sneaky message")

    with pytest.raises(HTTPException) as exc:
        send_message_to_thread(claim.id, payload, outsider, db_session)

    assert exc.value.status_code == 403


# ── Thread accessible regardless of claim status ─────────────────────────────


def test_thread_accessible_for_requested_claim(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="requested")

    result = get_thread_for_claim(claim.id, owner, db_session)

    assert result.claim_id == str(claim.id)


# ── Completed exchanges lock the thread (US-22 follow-up) ────────────────────


def test_thread_response_carries_the_claim_status(db_session):
    # The page needs the claim's status to know when to lock the composer.
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")

    result = get_thread_for_claim(claim.id, claimant, db_session)

    assert result.claim_status == "approved"


def test_completed_thread_is_readable_but_rejects_new_messages(db_session):
    # A completed exchange keeps its thread readable as history, but sending is
    # locked: the route answers 409 and writes neither a message nor a
    # notification.
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="completed")

    result = get_thread_for_claim(claim.id, owner, db_session)
    assert result.claim_status == "completed"

    payload = SendMessagePayload(body="One more thing...")
    with pytest.raises(HTTPException) as exc:
        send_message_to_thread(claim.id, payload, claimant, db_session)

    assert exc.value.status_code == 409
    assert "locked" in exc.value.detail.lower()

    saved_messages = db_session.scalars(select(Message)).all()
    assert saved_messages == []
    saved_notifications = db_session.scalars(select(Notification)).all()
    assert saved_notifications == []


def test_cancelled_thread_is_readable_but_rejects_new_messages(db_session):
    # A cancelled exchange locks its thread the same way a completed one does:
    # reading stays open as history, but sending answers 409 and writes
    # neither a message nor a notification.
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="cancelled")

    result = get_thread_for_claim(claim.id, owner, db_session)
    assert result.claim_status == "cancelled"

    payload = SendMessagePayload(body="Wait, one more question...")
    with pytest.raises(HTTPException) as exc:
        send_message_to_thread(claim.id, payload, claimant, db_session)

    assert exc.value.status_code == 409
    assert "cancelled" in exc.value.detail.lower()
    assert "locked" in exc.value.detail.lower()

    saved_messages = db_session.scalars(select(Message)).all()
    assert saved_messages == []
    saved_notifications = db_session.scalars(select(Notification)).all()
    assert saved_notifications == []


def test_thread_accessible_for_denied_claim(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="denied")

    result = get_thread_for_claim(claim.id, claimant, db_session)

    assert result.claim_id == str(claim.id)


# ── 404 on unknown claim ──────────────────────────────────────────────────────


def test_unknown_claim_id_returns_404(db_session):
    member = insert_member(db_session)

    with pytest.raises(HTTPException) as exc:
        get_thread_for_claim(uuid.uuid4(), member, db_session)

    assert exc.value.status_code == 404


# ── Route passthrough tests ───────────────────────────────────────────────────


def test_get_thread_endpoint_delegates_to_core(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    result = get_thread_endpoint(
        claim_id=str(claim.id),
        current_member=owner,
        session=db_session,
    )

    assert result.claim_id == str(claim.id)


def test_get_thread_endpoint_invalid_uuid_returns_404(db_session):
    owner = insert_member(db_session)

    with pytest.raises(HTTPException) as exc:
        get_thread_endpoint(
            claim_id="not-a-uuid",
            current_member=owner,
            session=db_session,
        )

    assert exc.value.status_code == 404


def test_send_message_endpoint_delegates_to_core(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)
    payload = SendMessagePayload(body="See you soon!")

    result = send_message_endpoint(
        claim_id=str(claim.id),
        payload=payload,
        current_member=claimant,
        session=db_session,
    )

    assert result.body == "See you soon!"
    assert result.sender_id == str(claimant.id)
