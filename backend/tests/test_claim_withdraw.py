# Tests for the withdraw claim endpoint (UC-12).

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.claim import withdraw_claim


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


def insert_claim(session, listing_id, claimant, quantity=3, status="requested"):
    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        status=status,
        requested_at=datetime.now(timezone.utc),
    )
    session.add(claim)
    session.commit()
    claim_id = claim.id
    return claim_id


# --- Scenario 1: happy path ------------------------------------------------


def test_withdraw_claim_happy_path(db_session):
    """Withdrawing a pending claim sets status to CANCELLED."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)

    response = withdraw_claim(str(claim_id), claimant, db_session)

    assert response.status == "cancelled"
    assert response.cancelled_at is not None
    assert response.approved_at is None
    assert response.denied_at is None
    assert response.approved_quantity is None


def test_withdraw_claim_persists_cancelled_fields(db_session):
    """The persisted claim row has cancelled_at and status = cancelled."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=5)

    withdraw_claim(str(claim_id), claimant, db_session)

    row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert row.status == "cancelled"
    assert row.cancelled_at is not None
    assert row.approved_quantity is None


def test_withdraw_claim_does_not_change_remaining_quantity(db_session):
    """Withdrawing a claim does not change the listing's remaining_quantity."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=4)

    withdraw_claim(str(claim_id), claimant, db_session)

    row = db_session.scalars(
        select(Listing).where(Listing.id == listing_id)
    ).first()
    assert row.remaining_quantity == 10


# --- Scenario 2: not pending -----------------------------------------------


def test_withdraw_rejects_approved_claim(db_session):
    """Cannot withdraw a claim that has already been approved."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="approved")

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    assert "not pending" in raised.value.detail.lower()


def test_withdraw_rejects_denied_claim(db_session):
    """Cannot withdraw a claim that has already been denied."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="denied")

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409


def test_withdraw_rejects_already_cancelled_claim(db_session):
    """Cannot withdraw a claim that has already been cancelled."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="cancelled")

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409


# --- Scenario 3: not the requester ------------------------------------------


def test_withdraw_rejects_non_claimant(db_session):
    """A member who is not the claimant cannot withdraw the claim."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    stranger = insert_member(db_session, email="stranger@example.com", name="Stranger")

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(claim_id), stranger, db_session)

    assert raised.value.status_code == 403
    assert "own" in raised.value.detail.lower()

    # Nothing changed.
    claim_row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert claim_row.status == "requested"


def test_withdraw_rejects_listing_owner(db_session):
    """The listing owner (poster) cannot withdraw someone else's claim."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 403


# --- edge cases -------------------------------------------------------------


def test_withdraw_rejects_bad_claim_id(db_session):
    """A non-UUID claim id returns 404."""
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        withdraw_claim("not-a-uuid", member, db_session)

    assert raised.value.status_code == 404


def test_withdraw_rejects_missing_claim(db_session):
    """An unknown UUID returns 404."""
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(uuid.uuid4()), member, db_session)

    assert raised.value.status_code == 404


# --- database failure -------------------------------------------------------


def test_withdraw_returns_503_on_database_error(broken_session):
    """A database error during withdrawal returns 503."""
    member = Member(
        id=uuid.uuid4(),
        name="Claimant",
        email="claimant@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(uuid.uuid4()), member, broken_session)

    assert raised.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_withdraw_route_is_wired():
    """The withdraw route is registered on the app with PATCH."""
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/withdraw" in route.path and "PATCH" in route.methods:
                found = True
    assert found
