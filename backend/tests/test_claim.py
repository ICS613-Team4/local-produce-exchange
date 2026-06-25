# Tests for the submit-claim endpoint (UC-09).


import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.claim import create_claim
from app.schemas.claim import POSTGRES_INTEGER_MAX, CreateClaimPayload


# --- helpers ----------------------------------------------------------------


def insert_member(session, status="active", email="requester@example.com", name="Requester"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner, remaining_quantity=10, status="active"):
    """Insert a listing owned by *owner* with the given remaining quantity."""
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
        status=status,
    )
    session.add(listing)
    session.commit()
    # Cache the id before it expires on the next commit.
    listing_id = listing.id
    return listing_id


def make_payload(quantity=3):
    return CreateClaimPayload(quantity=quantity)


def insert_claim(session, listing_id, claimant, quantity=2, status="requested", approved_quantity=None):
    """Insert a claim in a given state, used to set up an existing request."""
    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=datetime.now(timezone.utc),
    )
    session.add(claim)
    session.commit()
    return claim.id


def count_claims(session):
    rows = session.scalars(select(Claim)).all()
    return len(rows)


# --- Scenario 1: happy path ------------------------------------------------


def test_create_claim_happy_path(db_session):
    """A valid claim on an active listing creates a row with status REQUESTED."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com")

    payload = make_payload(quantity=3)
    response = create_claim(str(listing_id), payload, claimant, db_session)

    assert response.status == "requested"
    assert response.requested_quantity == 3
    assert response.listing_id == str(listing_id)
    assert response.claimant_id == str(claimant.id)

    # The persisted row matches.
    row = db_session.scalars(
        select(Claim).where(Claim.id == uuid.UUID(response.id))
    ).first()
    assert row is not None
    assert row.requested_quantity == 3
    assert row.status == "requested"
    assert row.approved_quantity is None
    assert row.approved_at is None
    assert row.picked_up_at is None
    assert row.completed_at is None
    assert row.cancelled_at is None
    assert row.denied_at is None


def test_create_claim_queue_ordering(db_session):
    """Two claims on the same listing get ordered by requested_at."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant_a = insert_member(db_session, email="a@example.com", name="A")
    claimant_b = insert_member(db_session, email="b@example.com", name="B")

    response_a = create_claim(str(listing_id), make_payload(2), claimant_a, db_session)
    response_b = create_claim(str(listing_id), make_payload(3), claimant_b, db_session)

    assert response_a.requested_at <= response_b.requested_at
    assert count_claims(db_session) == 2


# --- Scenario 2: quantity exceeds available ---------------------------------


def test_create_claim_rejects_quantity_exceeding_available(db_session):
    """Requesting more than remaining_quantity is rejected with 422."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com")

    payload = make_payload(quantity=12)

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), payload, claimant, db_session)

    assert raised.value.status_code == 422
    assert "exceeds" in raised.value.detail.lower()
    assert count_claims(db_session) == 0


def test_create_claim_rejects_quantity_one_over_remaining(db_session):
    """Boundary: requesting remaining + 1 is rejected."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=5)
    claimant = insert_member(db_session, email="claimant@example.com")

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(6), claimant, db_session)

    assert raised.value.status_code == 422
    assert count_claims(db_session) == 0


def test_create_claim_accepts_quantity_equal_to_remaining(db_session):
    """Boundary: requesting exactly remaining_quantity succeeds."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=5)
    claimant = insert_member(db_session, email="claimant@example.com")

    response = create_claim(str(listing_id), make_payload(5), claimant, db_session)

    assert response.requested_quantity == 5
    assert response.status == "requested"


# --- Scenario 3: quantity must be positive ----------------------------------


def test_schema_rejects_zero_quantity():
    """Pydantic rejects quantity = 0 before the route runs."""
    with pytest.raises(ValidationError):
        make_payload(quantity=0)


def test_schema_rejects_negative_quantity():
    """Pydantic rejects quantity < 0 before the route runs."""
    with pytest.raises(ValidationError):
        make_payload(quantity=-1)


# --- Scenario 4: duplicate open request ------------------------------------


def test_create_claim_rejects_duplicate_open_claim(db_session):
    """A member cannot submit a second open claim on the same listing."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com")

    # First claim succeeds.
    create_claim(str(listing_id), make_payload(2), claimant, db_session)

    # Second claim on the same listing is rejected.
    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(3), claimant, db_session)

    assert raised.value.status_code == 409
    assert "already" in raised.value.detail.lower()
    assert count_claims(db_session) == 1


# --- Scenario 5: suspended member ------------------------------------------


def test_create_claim_denies_suspended_member(db_session):
    """A suspended member cannot submit a claim."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(1), claimant, db_session)

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail.lower()
    assert count_claims(db_session) == 0


def test_create_claim_denies_inactive_member(db_session):
    """An inactive member cannot submit a claim."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(1), claimant, db_session)

    assert raised.value.status_code == 403
    assert "not active" in raised.value.detail.lower()
    assert count_claims(db_session) == 0


# --- listing guards ---------------------------------------------------------


def test_create_claim_rejects_missing_listing(db_session):
    """Claiming a listing that does not exist returns 404."""
    claimant = insert_member(db_session, email="claimant@example.com")
    missing_id = str(uuid.uuid4())

    with pytest.raises(HTTPException) as raised:
        create_claim(missing_id, make_payload(1), claimant, db_session)

    assert raised.value.status_code == 404
    assert count_claims(db_session) == 0


def test_create_claim_rejects_bad_listing_id(db_session):
    """A non-UUID listing id returns 404, not 500."""
    claimant = insert_member(db_session, email="claimant@example.com")

    with pytest.raises(HTTPException) as raised:
        create_claim("not-a-uuid", make_payload(1), claimant, db_session)

    assert raised.value.status_code == 404
    assert count_claims(db_session) == 0


def test_create_claim_rejects_inactive_listing(db_session):
    """A listing that is not active does not accept new claims."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10, status="deactivated")
    claimant = insert_member(db_session, email="claimant@example.com")

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(1), claimant, db_session)

    assert raised.value.status_code == 404
    assert count_claims(db_session) == 0


# --- self-request guard ----------------------------------------------------


def test_create_claim_blocks_owner_self_claim(db_session):
    """The listing owner cannot claim their own listing."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(1), poster, db_session)

    assert raised.value.status_code == 403
    assert "own listing" in raised.value.detail.lower()
    assert count_claims(db_session) == 0


# --- database failure -------------------------------------------------------


def test_create_claim_returns_503_on_database_error(broken_session):
    """A database error during insert returns 503, not 500."""
    member = Member(
        id=uuid.uuid4(),
        name="Claimant",
        email="claimant@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        create_claim(str(uuid.uuid4()), make_payload(1), member, broken_session)

    assert raised.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_create_claim_route_is_wired_with_201_status():
    """The route is registered on the app and returns 201."""
    from fastapi.routing import APIRoute

    from app.main import app

    found_status = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/claims" in route.path and "POST" in route.methods:
                found_status = route.status_code
    assert found_status == 201


# --- one request per listing, whatever the earlier state ---------------------
# A member may make only a single request on a listing, ever. The earlier
# request's state does not matter: approved, denied, or withdrawn all block a
# second request, so no duplicate ever enters the queue.


def test_create_claim_rejects_second_request_after_approved(db_session):
    """An approved earlier request blocks a new request from the same member."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com")
    insert_claim(db_session, listing_id, claimant, quantity=2, status="approved", approved_quantity=2)

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(3), claimant, db_session)

    assert raised.value.status_code == 409
    assert "already" in raised.value.detail.lower()
    # Still just the one claim; no duplicate was added.
    assert count_claims(db_session) == 1


def test_create_claim_rejects_second_request_after_denied(db_session):
    """A denied earlier request blocks a new request from the same member."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com")
    insert_claim(db_session, listing_id, claimant, quantity=2, status="denied")

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(3), claimant, db_session)

    assert raised.value.status_code == 409
    assert count_claims(db_session) == 1


def test_create_claim_rejects_second_request_after_withdrawn(db_session):
    """A withdrawn (cancelled) earlier request still blocks a new request."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant = insert_member(db_session, email="claimant@example.com")
    insert_claim(db_session, listing_id, claimant, quantity=2, status="cancelled")

    with pytest.raises(HTTPException) as raised:
        create_claim(str(listing_id), make_payload(3), claimant, db_session)

    assert raised.value.status_code == 409
    assert count_claims(db_session) == 1


def test_create_claim_allows_different_members_on_same_listing(db_session):
    """The one-request rule is per member: another member can still request."""
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=10)
    claimant_a = insert_member(db_session, email="a@example.com", name="A")
    claimant_b = insert_member(db_session, email="b@example.com", name="B")

    insert_claim(db_session, listing_id, claimant_a, quantity=2, status="denied")

    # B has no prior claim, so B's request goes through.
    response = create_claim(str(listing_id), make_payload(3), claimant_b, db_session)

    assert response.status == "requested"
    assert count_claims(db_session) == 2


# --- integer overflow guard --------------------------------------------------
# requested_quantity is a 32-bit Postgres Integer. The schema caps the value at
# that column's max so an oversized request is refused at validation, before it
# can overflow the column.


def test_schema_accepts_max_integer_quantity():
    """The largest 32-bit integer is allowed by the schema."""
    payload = make_payload(quantity=POSTGRES_INTEGER_MAX)
    assert payload.quantity == POSTGRES_INTEGER_MAX


def test_schema_rejects_quantity_above_integer_max():
    """One above the 32-bit max is rejected by validation."""
    with pytest.raises(ValidationError):
        make_payload(quantity=POSTGRES_INTEGER_MAX + 1)
