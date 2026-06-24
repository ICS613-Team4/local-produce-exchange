# Tests for the approve/deny claim endpoints (UC-11).

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.claim import approve_claim, deny_claim


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


# --- Scenario 1: approve happy path ----------------------------------------


def test_approve_claim_happy_path(db_session):
    """Approving a pending claim sets status to APPROVED and approved_quantity."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)

    response = approve_claim(str(claim_id), poster, db_session)

    assert response.status == "approved"
    assert response.approved_quantity == 3
    assert response.requested_quantity == 3
    assert response.approved_at is not None
    assert response.denied_at is None


def test_approve_claim_reduces_remaining_quantity(db_session):
    """Approving a claim reduces the listing's remaining_quantity."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=4)

    approve_claim(str(claim_id), poster, db_session)

    # Check the listing row was updated.
    row = db_session.scalars(
        select(Listing).where(Listing.id == listing_id)
    ).first()
    assert row.remaining_quantity == 6


def test_approve_claim_persists_approved_fields(db_session):
    """The persisted claim row has approved_quantity, approved_at, and status."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=5)

    approve_claim(str(claim_id), poster, db_session)

    row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert row.status == "approved"
    assert row.approved_quantity == 5
    assert row.approved_at is not None
    assert row.denied_at is None


# --- Scenario 2: deny happy path -------------------------------------------


def test_deny_claim_happy_path(db_session):
    """Denying a pending claim sets status to DENIED and denied_at."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)

    response = deny_claim(str(claim_id), poster, db_session)

    assert response.status == "denied"
    assert response.denied_at is not None
    assert response.approved_at is None
    assert response.approved_quantity is None


def test_deny_claim_does_not_change_remaining_quantity(db_session):
    """Denying a claim does not change the listing's remaining_quantity."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=4)

    deny_claim(str(claim_id), poster, db_session)

    row = db_session.scalars(
        select(Listing).where(Listing.id == listing_id)
    ).first()
    assert row.remaining_quantity == 10


def test_deny_claim_persists_denied_fields(db_session):
    """The persisted claim row has denied_at and status = denied."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=5)

    deny_claim(str(claim_id), poster, db_session)

    row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert row.status == "denied"
    assert row.denied_at is not None
    assert row.approved_quantity is None
    assert row.approved_at is None


# --- Scenario 3: conflict prevention ---------------------------------------


def test_approve_rejects_when_quantity_exceeds_remaining(db_session):
    """Approving a claim that would exceed remaining_quantity is rejected."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=2)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=5)

    with pytest.raises(HTTPException) as raised:
        approve_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 409
    assert "exceeds" in raised.value.detail.lower()

    # Nothing changed.
    claim_row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert claim_row.status == "requested"

    listing_row = db_session.scalars(
        select(Listing).where(Listing.id == listing_id)
    ).first()
    assert listing_row.remaining_quantity == 2


def test_approve_boundary_exact_remaining_succeeds(db_session):
    """Approving a claim for exactly the remaining quantity succeeds."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=5)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=5)

    response = approve_claim(str(claim_id), poster, db_session)

    assert response.status == "approved"

    listing_row = db_session.scalars(
        select(Listing).where(Listing.id == listing_id)
    ).first()
    assert listing_row.remaining_quantity == 0


# --- Scenario 4: wrong status ----------------------------------------------


def test_approve_rejects_already_approved_claim(db_session):
    """Cannot approve a claim that is not in REQUESTED status."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="approved")

    with pytest.raises(HTTPException) as raised:
        approve_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 409
    assert "not pending" in raised.value.detail.lower()


def test_approve_rejects_denied_claim(db_session):
    """Cannot approve a claim that has already been denied."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="denied")

    with pytest.raises(HTTPException) as raised:
        approve_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 409


def test_deny_rejects_already_denied_claim(db_session):
    """Cannot deny a claim that is not in REQUESTED status."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="denied")

    with pytest.raises(HTTPException) as raised:
        deny_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 409
    assert "not pending" in raised.value.detail.lower()


def test_deny_rejects_approved_claim(db_session):
    """Cannot deny a claim that has already been approved."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3, status="approved")

    with pytest.raises(HTTPException) as raised:
        deny_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 409


# --- Scenario 5: not the listing owner -------------------------------------


def test_approve_rejects_non_owner(db_session):
    """A member who does not own the listing cannot approve claims."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    stranger = insert_member(db_session, email="stranger@example.com", name="Stranger")

    with pytest.raises(HTTPException) as raised:
        approve_claim(str(claim_id), stranger, db_session)

    assert raised.value.status_code == 403
    assert "owner" in raised.value.detail.lower()

    # Nothing changed.
    claim_row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert claim_row.status == "requested"


def test_deny_rejects_non_owner(db_session):
    """A member who does not own the listing cannot deny claims."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    stranger = insert_member(db_session, email="stranger@example.com", name="Stranger")

    with pytest.raises(HTTPException) as raised:
        deny_claim(str(claim_id), stranger, db_session)

    assert raised.value.status_code == 403
    assert "owner" in raised.value.detail.lower()

    # Nothing changed.
    claim_row = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert claim_row.status == "requested"


# --- edge cases: bad/missing claim id ---------------------------------------


def test_approve_rejects_bad_claim_id(db_session):
    """A non-UUID claim id returns 404."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")

    with pytest.raises(HTTPException) as raised:
        approve_claim("not-a-uuid", poster, db_session)

    assert raised.value.status_code == 404


def test_deny_rejects_bad_claim_id(db_session):
    """A non-UUID claim id returns 404."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")

    with pytest.raises(HTTPException) as raised:
        deny_claim("not-a-uuid", poster, db_session)

    assert raised.value.status_code == 404


def test_approve_rejects_missing_claim(db_session):
    """An unknown UUID returns 404."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")

    with pytest.raises(HTTPException) as raised:
        approve_claim(str(uuid.uuid4()), poster, db_session)

    assert raised.value.status_code == 404


def test_deny_rejects_missing_claim(db_session):
    """An unknown UUID returns 404."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")

    with pytest.raises(HTTPException) as raised:
        deny_claim(str(uuid.uuid4()), poster, db_session)

    assert raised.value.status_code == 404


# --- database failure -------------------------------------------------------


def test_approve_returns_503_on_database_error(broken_session):
    """A database error during approval returns 503."""
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        approve_claim(str(uuid.uuid4()), member, broken_session)

    assert raised.value.status_code == 503


def test_deny_returns_503_on_database_error(broken_session):
    """A database error during denial returns 503."""
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        deny_claim(str(uuid.uuid4()), member, broken_session)

    assert raised.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_approve_route_is_wired():
    """The approve route is registered on the app with PATCH."""
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/approve" in route.path and "PATCH" in route.methods:
                found = True
    assert found


def test_deny_route_is_wired():
    """The deny route is registered on the app with PATCH."""
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/deny" in route.path and "PATCH" in route.methods:
                found = True
    assert found
