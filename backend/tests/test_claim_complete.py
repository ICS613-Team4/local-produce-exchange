# Tests for completing a picked-up exchange (UC-18).

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.claim import complete_exchange


class FakeScalarResult:
    def __init__(self, value):
        self.value = value

    def first(self):
        return self.value


class ListingResultSession:
    def __init__(self, claim, listing_result):
        self.claim = claim
        self.listing_result = listing_result
        self.query_count = 0

    def scalars(self, statement):
        self.query_count = self.query_count + 1
        if self.query_count == 1:
            return FakeScalarResult(self.claim)
        if isinstance(self.listing_result, Exception):
            raise self.listing_result
        return FakeScalarResult(self.listing_result)


class CommitFailsSession:
    def __init__(self, session):
        self.session = session

    def scalars(self, statement):
        return self.session.scalars(statement)

    def add(self, instance):
        # The route saves a notification (US-22) with session.add before its
        # commit, so this fake must accept the add and pass it through.
        self.session.add(instance)

    def commit(self):
        raise OperationalError("commit", {}, Exception("database is down"))

    def rollback(self):
        self.session.rollback()


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


def insert_claim(session, listing_id, claimant, quantity=3, status="picked_up"):
    now = datetime.now(timezone.utc)
    approved_quantity = None
    approved_at = None
    picked_up_at = None
    completed_at = None
    cancelled_at = None
    denied_at = None

    if status == "approved" or status == "picked_up" or status == "completed":
        approved_quantity = quantity
        approved_at = now - timedelta(minutes=20)
    if status == "picked_up" or status == "completed":
        picked_up_at = now - timedelta(minutes=10)
    if status == "completed":
        completed_at = now
    if status == "cancelled":
        cancelled_at = now
    if status == "denied":
        denied_at = now

    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=now - timedelta(minutes=30),
        approved_at=approved_at,
        picked_up_at=picked_up_at,
        completed_at=completed_at,
        cancelled_at=cancelled_at,
        denied_at=denied_at,
    )
    session.add(claim)
    session.commit()
    return claim.id


def test_complete_exchange_happy_path(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant)
    original_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    original_picked_up_at = original_claim.picked_up_at

    response = complete_exchange(str(claim_id), poster, db_session)

    assert response.status == "completed"
    assert response.completed_at is not None
    assert response.picked_up_at == original_picked_up_at

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert saved_claim.status == "completed"
    assert saved_claim.completed_at is not None
    assert saved_claim.picked_up_at == original_picked_up_at


def test_complete_exchange_leaves_listing_quantity_unchanged(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster, remaining_quantity=7)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant)

    complete_exchange(str(claim_id), poster, db_session)

    listing = db_session.scalars(
        select(Listing).where(Listing.id == listing_id)
    ).first()
    assert listing.remaining_quantity == 7


@pytest.mark.parametrize(
    "claim_status",
    ["requested", "approved", "completed", "cancelled", "denied"],
)
def test_complete_exchange_rejects_wrong_status(db_session, claim_status):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant, status=claim_status)
    original_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    original_completed_at = original_claim.completed_at

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(claim_id), poster, db_session)

    assert raised.value.status_code == 409
    assert raised.value.detail == (
        "This exchange is not picked up, so it cannot be completed."
    )
    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert saved_claim.status == claim_status
    assert saved_claim.completed_at == original_completed_at


def test_complete_exchange_rejects_non_owner(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    stranger = insert_member(db_session, email="stranger@example.com", name="Stranger")
    claim_id = insert_claim(db_session, listing_id, claimant)

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(claim_id), stranger, db_session)

    assert raised.value.status_code == 403
    assert raised.value.detail == "Only the listing owner can complete the exchange."
    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert saved_claim.status == "picked_up"
    assert saved_claim.completed_at is None


def test_complete_exchange_rejects_bad_claim_id(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")

    with pytest.raises(HTTPException) as raised:
        complete_exchange("not-a-uuid", poster, db_session)

    assert raised.value.status_code == 404


def test_complete_exchange_rejects_missing_claim(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(uuid.uuid4()), poster, db_session)

    assert raised.value.status_code == 404


@pytest.mark.parametrize(
    ("member_status", "detail_text"),
    [
        ("suspended", "Your account is suspended"),
        ("inactive", "Your account is not active"),
    ],
)
def test_complete_exchange_rejects_non_active_owner(
    db_session,
    member_status,
    detail_text,
):
    poster = insert_member(
        db_session,
        status=member_status,
        email=member_status + "@example.com",
        name="Poster",
    )
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant)

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(claim_id), poster, db_session)

    assert raised.value.status_code == 403
    assert detail_text in raised.value.detail
    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert saved_claim.status == "picked_up"


def test_complete_exchange_returns_503_on_database_error(broken_session):
    poster = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(uuid.uuid4()), poster, broken_session)

    assert raised.value.status_code == 503


def test_complete_exchange_returns_503_on_listing_load_error():
    poster_id = uuid.uuid4()
    listing_id = uuid.uuid4()
    claim = Claim(
        id=uuid.uuid4(),
        listing_id=listing_id,
        claimant_id=uuid.uuid4(),
        requested_quantity=1,
        approved_quantity=1,
        status="picked_up",
        requested_at=datetime.now(timezone.utc),
        approved_at=datetime.now(timezone.utc),
        picked_up_at=datetime.now(timezone.utc),
    )
    poster = Member(
        id=poster_id,
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    error = OperationalError("statement", {}, Exception("database is down"))
    session = ListingResultSession(claim, error)

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(claim.id), poster, session)

    assert raised.value.status_code == 503


def test_complete_exchange_rejects_missing_listing():
    poster = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    claim = Claim(
        id=uuid.uuid4(),
        listing_id=uuid.uuid4(),
        claimant_id=uuid.uuid4(),
        requested_quantity=1,
        approved_quantity=1,
        status="picked_up",
        requested_at=datetime.now(timezone.utc),
        approved_at=datetime.now(timezone.utc),
        picked_up_at=datetime.now(timezone.utc),
    )
    session = ListingResultSession(claim, None)

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(claim.id), poster, session)

    assert raised.value.status_code == 404


def test_complete_exchange_returns_503_when_commit_fails(db_session):
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_id = insert_listing(db_session, poster)
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    claim_id = insert_claim(db_session, listing_id, claimant)
    session = CommitFailsSession(db_session)

    with pytest.raises(HTTPException) as raised:
        complete_exchange(str(claim_id), poster, session)

    assert raised.value.status_code == 503
    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim_id)
    ).first()
    assert saved_claim.status == "picked_up"
    assert saved_claim.completed_at is None


def test_complete_exchange_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/claims/{claim_id}/complete":
                if "PATCH" in route.methods:
                    found = True
    assert found
