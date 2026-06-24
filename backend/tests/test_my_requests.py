# Tests for the outgoing-requests endpoint (the caller's own pending requests on
# other members' listings). The mirror of test_request_queues.py.
# Run from the project root with:
# uv run --locked --all-groups --directory backend pytest tests/test_my_requests.py -v

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError

from app.main import app
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.claim import get_my_requests


# Local setup helpers, following the per-file convention (issue #124 tracks the
# shared extraction).
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


def insert_listing(session, owner, title="Fresh Tomatoes", status="active", created_at=None):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description="Ripe red tomatoes from the garden.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status=status,
    )
    # now() is the same for every insert inside one test transaction, so a test
    # that needs distinct created_at values passes them in explicitly.
    if created_at is not None:
        listing.created_at = created_at
    session.add(listing)
    session.commit()
    return listing


def insert_claim(session, listing, claimant, requested_quantity=1, status="requested", requested_at=None):
    if requested_at is None:
        requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=requested_quantity,
        status=status,
        requested_at=requested_at,
    )
    session.add(claim)
    session.commit()
    return claim


# --- happy path -------------------------------------------------------------


def test_my_requests_happy_path(db_session):
    # The caller has pending requests on two listings owned by other members. The
    # response has one group per listing, newest listing first, each group holding
    # the caller's own request with the caller's name and quantity.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster_one = insert_member(db_session, email="p1@example.com", name="Poster One")
    poster_two = insert_member(db_session, email="p2@example.com", name="Poster Two")
    older_time = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    older_listing = insert_listing(db_session, poster_one, title="Apples", created_at=older_time)
    newer_listing = insert_listing(db_session, poster_two, title="Zucchini", created_at=newer_time)
    insert_claim(db_session, older_listing, caller, requested_quantity=3)
    insert_claim(db_session, newer_listing, caller, requested_quantity=4)

    response = get_my_requests(caller, db_session)

    assert len(response.groups) == 2
    # Newest listing first.
    assert response.groups[0].listing_title == "Zucchini"
    assert response.groups[1].listing_title == "Apples"
    # Each group holds the caller's own single request, named for the caller.
    first_group = response.groups[0]
    assert len(first_group.pending) == 1
    assert first_group.pending[0].claimant_name == "Cara"
    assert first_group.pending[0].requested_quantity == 4
    second_group = response.groups[1]
    assert second_group.pending[0].claimant_name == "Cara"
    assert second_group.pending[0].requested_quantity == 3


def test_my_requests_scopes_to_the_caller(db_session):
    # Another member's request on the same listing is never in the caller's
    # outgoing view.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    other = insert_member(db_session, email="other@example.com", name="Other")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, requested_quantity=2)
    insert_claim(db_session, listing, other, requested_quantity=5)

    response = get_my_requests(caller, db_session)

    assert len(response.groups) == 1
    assert len(response.groups[0].pending) == 1
    assert response.groups[0].pending[0].claimant_name == "Cara"
    assert response.groups[0].pending[0].requested_quantity == 2


def test_my_requests_empty_when_no_pending(db_session):
    caller = insert_member(db_session, email="cara@example.com", name="Cara")

    response = get_my_requests(caller, db_session)

    assert response.groups == []


@pytest.mark.parametrize(
    "excluded_status",
    ["approved", "picked_up", "completed", "cancelled", "denied"],
)
def test_my_requests_excludes_non_requested_status(db_session, excluded_status):
    # Only a "requested" claim is pending, so a non-requested claim by the caller
    # produces no group.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, status=excluded_status)

    response = get_my_requests(caller, db_session)

    assert response.groups == []


# --- caller status gate -----------------------------------------------------


def test_my_requests_denies_suspended_caller(db_session):
    caller = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_my_requests(caller, db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail.lower()


def test_my_requests_denies_inactive_caller(db_session):
    caller = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_my_requests(caller, db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail.lower()


# --- database failures -------------------------------------------------------


def test_my_requests_returns_503_on_claims_load_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Cara",
        email="cara@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        get_my_requests(member, broken_session)

    assert raised_error.value.status_code == 503


# A claim row whose listing relationship read fails, to reach the listing-read
# try/except.
class ListingReadFails:
    def __init__(self):
        self.id = uuid.uuid4()
        self.requested_quantity = 1
        self.requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)

    @property
    def listing(self):
        raise OperationalError("statement", {}, Exception("listing load failed"))


class ScalarsListStub:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class ListingReadFailsSession:
    def __init__(self, claims):
        self.claims = claims

    def scalars(self, *args, **kwargs):
        return ScalarsListStub(self.claims)

    def close(self, *args, **kwargs):
        pass


def test_my_requests_returns_503_on_listing_read_error():
    member = Member(
        id=uuid.uuid4(),
        name="Cara",
        email="cara@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    session = ListingReadFailsSession([ListingReadFails()])

    with pytest.raises(HTTPException) as raised_error:
        get_my_requests(member, session)

    assert raised_error.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_my_requests_route_is_wired_with_get_method():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/my-requests" and "GET" in route.methods:
                found_route = route
    assert found_route is not None
