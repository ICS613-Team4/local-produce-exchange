# Tests for the "my claim on this listing" endpoint. The listing detail page
# uses it to show a requester their own request status (requested, approved,
# denied, or withdrawn) across reloads, or null when they have not requested.

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.claim import get_my_claim_for_listing


# --- helpers ----------------------------------------------------------------


def insert_member(session, status="active", email="member@example.com", name="Member"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner, remaining_quantity=10):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=remaining_quantity,
        remaining_quantity=remaining_quantity,
        pickup_window=Range(start, end, bounds="[)"),
        status="active",
    )
    session.add(listing)
    session.commit()
    listing_id = listing.id
    return listing_id


def insert_claim(
    session,
    listing_id,
    claimant,
    quantity=3,
    status="requested",
    approved_quantity=None,
    approved_at=None,
    denied_at=None,
):
    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=datetime.now(timezone.utc),
        approved_at=approved_at,
        denied_at=denied_at,
    )
    session.add(claim)
    session.commit()
    claim_id = claim.id
    return claim_id


# --- no claim ---------------------------------------------------------------


def test_my_claim_returns_none_when_no_request(db_session):
    """A member who has not requested this listing gets null."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    viewer = insert_member(db_session, email="viewer@example.com", name="Viewer")

    result = get_my_claim_for_listing(str(listing_id), viewer, db_session)

    assert result is None


def test_my_claim_bad_listing_id_returns_none(db_session):
    """A non-UUID listing id cannot match a claim, so it returns null."""
    viewer = insert_member(db_session, email="viewer@example.com", name="Viewer")

    result = get_my_claim_for_listing("not-a-uuid", viewer, db_session)

    assert result is None


# --- a claim in each state --------------------------------------------------


def test_my_claim_returns_requested_claim(db_session):
    """A pending request comes back with its quantity and requested time."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    viewer = insert_member(db_session, email="viewer@example.com", name="Viewer")
    claim_id = insert_claim(db_session, listing_id, viewer, quantity=4)

    result = get_my_claim_for_listing(str(listing_id), viewer, db_session)

    assert result is not None
    assert result.id == str(claim_id)
    assert result.status == "requested"
    assert result.requested_quantity == 4
    assert result.requested_at is not None
    assert result.approved_at is None
    assert result.denied_at is None


def test_my_claim_returns_approved_claim_with_fields(db_session):
    """An approved request carries the approved quantity and approved time."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    viewer = insert_member(db_session, email="viewer@example.com", name="Viewer")
    approved_at = datetime(2026, 7, 2, 10, 0, tzinfo=timezone.utc)
    insert_claim(
        db_session,
        listing_id,
        viewer,
        quantity=5,
        status="approved",
        approved_quantity=2,
        approved_at=approved_at,
    )

    result = get_my_claim_for_listing(str(listing_id), viewer, db_session)

    assert result is not None
    assert result.status == "approved"
    assert result.approved_quantity == 2
    assert result.requested_quantity == 5
    assert result.approved_at is not None


def test_my_claim_returns_denied_claim(db_session):
    """A denied request comes back with status denied."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    viewer = insert_member(db_session, email="viewer@example.com", name="Viewer")
    denied_at = datetime(2026, 7, 2, 10, 0, tzinfo=timezone.utc)
    insert_claim(db_session, listing_id, viewer, quantity=3, status="denied", denied_at=denied_at)

    result = get_my_claim_for_listing(str(listing_id), viewer, db_session)

    assert result is not None
    assert result.status == "denied"
    assert result.denied_at is not None


def test_my_claim_only_returns_the_viewers_own_claim(db_session):
    """Another member's request on the same listing is not returned."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    other = insert_member(db_session, email="other@example.com", name="Other")
    insert_claim(db_session, listing_id, other, quantity=3)
    viewer = insert_member(db_session, email="viewer@example.com", name="Viewer")

    result = get_my_claim_for_listing(str(listing_id), viewer, db_session)

    assert result is None


# --- permission gate --------------------------------------------------------


def test_my_claim_denies_suspended_member(db_session):
    """A suspended member cannot read request status."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    viewer = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised:
        get_my_claim_for_listing(str(listing_id), viewer, db_session)

    assert raised.value.status_code == 403


# --- database failure -------------------------------------------------------


def test_my_claim_returns_503_on_database_error(broken_session):
    """A database error while reading the claim returns 503."""
    member = Member(
        id=uuid.uuid4(),
        name="Viewer",
        email="viewer@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        get_my_claim_for_listing(str(uuid.uuid4()), member, broken_session)

    assert raised.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_my_claim_route_is_wired(db_session):
    """The my-claim route is registered on the app with GET."""
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/my-claim" in route.path and "GET" in route.methods:
                found = True
    assert found
