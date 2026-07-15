# Tests for cancelling an approved claim (US-13).

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.notification import Notification
from app.routers.claim import approve_claim, cancel_approved_claim


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
    return listing.id


def insert_claim(
    session,
    listing_id,
    claimant,
    quantity=3,
    status="requested",
    approved_quantity=None,
):
    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=datetime.now(timezone.utc),
    )
    if status == "approved":
        claim.approved_at = datetime.now(timezone.utc)
    session.add(claim)
    session.commit()
    return claim.id


def test_cancel_approved_claim_happy_path(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)

    response = cancel_approved_claim(str(claim_id), claimant, db_session)

    assert response.status == "cancelled"
    assert response.cancelled_at is not None
    assert response.approved_quantity == 3
    assert response.approved_at is not None


def test_cancel_restores_remaining_quantity(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)

    cancel_approved_claim(str(claim_id), claimant, db_session)

    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert listing.remaining_quantity == 10


def test_cancel_persists_cancelled_fields(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)

    cancel_approved_claim(str(claim_id), claimant, db_session)

    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    assert claim.status == "cancelled"
    assert claim.cancelled_at is not None
    assert claim.approved_quantity == 3


def test_cancel_notifies_the_listing_owner(db_session):
    # The recipient cancels, so the poster is the one who needs to hear about
    # it (US-22): their quantity is back on the listing.
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)

    cancel_approved_claim(str(claim_id), claimant, db_session)

    notifications = db_session.scalars(
        select(Notification)
        .where(Notification.claim_id == claim_id)
        .where(Notification.kind == "request_cancelled")
    ).all()
    assert len(notifications) == 1
    assert notifications[0].member_id == poster.id
    assert "Claimant" in notifications[0].message
    assert "Fresh Tomatoes" in notifications[0].message


def test_cancel_restores_partial_approved_amount(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=2)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=5)
    approve_claim(str(claim_id), poster, db_session)

    cancel_approved_claim(str(claim_id), claimant, db_session)

    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert listing.remaining_quantity == 2


def test_cancel_rejects_requested_claim(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    assert "not approved" in raised.value.detail.lower()
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert claim.status == "requested"
    assert listing.remaining_quantity == 10


def test_cancel_rejects_picked_up_claim(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, status="picked_up")

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    assert claim.status == "picked_up"


def test_cancel_rejects_completed_claim(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, status="completed")

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    assert claim.status == "completed"


def test_cancel_rejects_denied_claim(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, status="denied")

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    assert claim.status == "denied"


def test_cancel_rejects_already_cancelled_claim(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, status="cancelled")

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    assert claim.status == "cancelled"


def test_cancel_rejects_non_claimant(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    stranger = insert_member(db_session, email="stranger@example.com", name="Stranger")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), stranger, db_session)

    assert raised.value.status_code == 403
    assert "own" in raised.value.detail.lower()
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert claim.status == "approved"
    assert listing.remaining_quantity == 7


def test_cancel_rejects_listing_owner(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), poster, db_session)

    assert raised.value.status_code == 403
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert claim.status == "approved"
    assert listing.remaining_quantity == 7


def test_cancel_rejects_bad_claim_id(db_session):
    member = insert_member(db_session)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim("not-a-uuid", member, db_session)

    assert raised.value.status_code == 404


def test_cancel_rejects_missing_claim(db_session):
    member = insert_member(db_session)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(uuid.uuid4()), member, db_session)

    assert raised.value.status_code == 404


def test_cancel_rejects_missing_approved_quantity(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, status="approved")

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, db_session)

    assert raised.value.status_code == 409
    assert "allocated quantity" in raised.value.detail.lower()
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert claim.status == "approved"
    assert listing.remaining_quantity == 10


def test_cancel_returns_503_on_database_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Claimant",
        email="claimant@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(uuid.uuid4()), member, broken_session)

    assert raised.value.status_code == 503


class SecondReadFailsSession:
    def __init__(self, session):
        self.session = session
        self.read_count = 0

    def scalars(self, statement):
        self.read_count = self.read_count + 1
        if self.read_count == 2:
            raise OperationalError("statement", {}, Exception("database is down"))
        return self.session.scalars(statement)


def test_cancel_returns_503_when_listing_read_fails(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)
    failing_session = SecondReadFailsSession(db_session)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, failing_session)

    assert raised.value.status_code == 503
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    assert claim.status == "approved"


class CommitFailsSession:
    def __init__(self, session):
        self.session = session
        self.rollback_called = False

    def scalars(self, statement):
        return self.session.scalars(statement)

    def add(self, instance):
        # The route saves a notification (US-22) with session.add before its
        # commit, so this fake has to accept the add and pass it through.
        self.session.add(instance)

    def commit(self):
        raise OperationalError("statement", {}, Exception("database is down"))

    def rollback(self):
        self.rollback_called = True
        self.session.rollback()


def test_cancel_returns_503_when_commit_fails(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, quantity=3)
    approve_claim(str(claim_id), poster, db_session)
    failing_session = CommitFailsSession(db_session)

    with pytest.raises(HTTPException) as raised:
        cancel_approved_claim(str(claim_id), claimant, failing_session)

    assert raised.value.status_code == 503
    assert failing_session.rollback_called is True
    claim = db_session.scalars(select(Claim).where(Claim.id == claim_id)).first()
    listing = db_session.scalars(select(Listing).where(Listing.id == listing_id)).first()
    assert claim.status == "approved"
    assert listing.remaining_quantity == 7


def test_cancel_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/cancel" in route.path and "PATCH" in route.methods:
                found = True
    assert found
