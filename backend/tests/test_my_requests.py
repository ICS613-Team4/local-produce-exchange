# Tests for the my-requests endpoint: the caller's own requests, split into three
# sections (pending, approved, denied), each newest-first with an id tiebreaker.
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
from app.models.listing_photo import ListingPhoto
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
    if created_at is not None:
        listing.created_at = created_at
    session.add(listing)
    session.commit()
    return listing


def insert_claim(
    session,
    listing,
    claimant,
    requested_quantity=1,
    status="requested",
    requested_at=None,
    approved_quantity=None,
    approved_at=None,
    denied_at=None,
    cancelled_at=None,
):
    if requested_at is None:
        requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=requested_quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=requested_at,
        approved_at=approved_at,
        denied_at=denied_at,
        cancelled_at=cancelled_at,
    )
    session.add(claim)
    session.commit()
    return claim


# --- the three sections -----------------------------------------------------


def test_my_requests_splits_into_pending_approved_denied(db_session):
    # The caller has one request in each state. Each lands in its own section with
    # the right fields.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_pending = insert_listing(db_session, poster, title="Apples")
    listing_approved = insert_listing(db_session, poster, title="Bananas")
    listing_denied = insert_listing(db_session, poster, title="Cherries")

    insert_claim(db_session, listing_pending, caller, requested_quantity=3)
    approved_at = datetime(2026, 7, 2, 10, 0, tzinfo=timezone.utc)
    insert_claim(
        db_session,
        listing_approved,
        caller,
        requested_quantity=5,
        status="approved",
        approved_quantity=2,
        approved_at=approved_at,
    )
    denied_at = datetime(2026, 7, 2, 11, 0, tzinfo=timezone.utc)
    insert_claim(
        db_session,
        listing_denied,
        caller,
        requested_quantity=4,
        status="denied",
        denied_at=denied_at,
    )

    response = get_my_requests(caller, db_session)

    assert len(response.pending) == 1
    assert response.pending[0].listing_title == "Apples"
    assert response.pending[0].requested_quantity == 3
    assert response.pending[0].status == "requested"

    assert len(response.approved) == 1
    assert response.approved[0].listing_title == "Bananas"
    assert response.approved[0].requested_quantity == 5
    assert response.approved[0].approved_quantity == 2
    assert response.approved[0].approved_at is not None
    assert response.approved[0].status == "approved"

    assert len(response.denied) == 1
    assert response.denied[0].listing_title == "Cherries"
    assert response.denied[0].requested_quantity == 4
    assert response.denied[0].denied_at is not None
    assert response.denied[0].status == "denied"


def test_my_requests_withdrawn_section_is_newest_first(db_session):
    # Two withdrawn (cancelled) requests land in the withdrawn section, newest
    # cancellation first, and carry their cancelled_at.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_older = insert_listing(db_session, poster, title="Apples")
    listing_newer = insert_listing(db_session, poster, title="Bananas")

    insert_claim(
        db_session,
        listing_older,
        caller,
        status="cancelled",
        cancelled_at=datetime(2026, 7, 2, 9, 0, tzinfo=timezone.utc),
    )
    insert_claim(
        db_session,
        listing_newer,
        caller,
        status="cancelled",
        cancelled_at=datetime(2026, 7, 3, 9, 0, tzinfo=timezone.utc),
    )

    response = get_my_requests(caller, db_session)

    assert response.pending == []
    assert len(response.withdrawn) == 2
    assert response.withdrawn[0].listing_title == "Bananas"
    assert response.withdrawn[1].listing_title == "Apples"
    assert response.withdrawn[0].cancelled_at is not None
    assert response.withdrawn[0].status == "cancelled"


def test_my_requests_carries_the_listing_photos(db_session):
    # A request on a listing with photos returns them ordered by position, so
    # the page can show the cover photo. A request on a photo-less listing
    # returns an empty list.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_with_photos = insert_listing(db_session, poster, title="Apples")
    listing_without_photos = insert_listing(db_session, poster, title="Bananas")

    second_photo = ListingPhoto(
        listing_id=listing_with_photos.id,
        content_type="image/webp",
        image_bytes=b"webp-bytes",
        position=1,
    )
    first_photo = ListingPhoto(
        listing_id=listing_with_photos.id,
        content_type="image/png",
        image_bytes=b"png-bytes",
        position=0,
    )
    db_session.add(second_photo)
    db_session.add(first_photo)
    db_session.commit()

    insert_claim(db_session, listing_with_photos, caller, requested_quantity=1)
    insert_claim(
        db_session,
        listing_without_photos,
        caller,
        requested_quantity=2,
        requested_at=datetime(2026, 7, 1, 13, 0, tzinfo=timezone.utc),
    )

    response = get_my_requests(caller, db_session)

    assert len(response.pending) == 2
    # Newest first, so the photo-less Bananas request comes before Apples.
    assert response.pending[0].listing_title == "Bananas"
    assert response.pending[0].photos == []
    assert response.pending[1].listing_title == "Apples"
    assert len(response.pending[1].photos) == 2
    assert response.pending[1].photos[0].id == str(first_photo.id)
    assert response.pending[1].photos[0].content_type == "image/png"
    assert response.pending[1].photos[0].position == 0
    assert response.pending[1].photos[1].id == str(second_photo.id)


def test_my_requests_pending_is_newest_first(db_session):
    # Two pending requests on different listings, with distinct requested_at. The
    # newer one comes first.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_one = insert_listing(db_session, poster, title="Older")
    listing_two = insert_listing(db_session, poster, title="Newer")
    older_time = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 7, 1, 15, 0, tzinfo=timezone.utc)
    insert_claim(db_session, listing_one, caller, requested_at=older_time)
    insert_claim(db_session, listing_two, caller, requested_at=newer_time)

    response = get_my_requests(caller, db_session)

    assert len(response.pending) == 2
    assert response.pending[0].listing_title == "Newer"
    assert response.pending[1].listing_title == "Older"


def test_my_requests_scopes_to_the_caller(db_session):
    # Another member's request on the same listing is never in the caller's view.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    other = insert_member(db_session, email="other@example.com", name="Other")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, requested_quantity=2)
    insert_claim(db_session, listing, other, requested_quantity=5)

    response = get_my_requests(caller, db_session)

    assert len(response.pending) == 1
    assert response.pending[0].requested_quantity == 2
    assert response.approved == []
    assert response.denied == []


def test_my_requests_all_sections_empty_when_no_requests(db_session):
    caller = insert_member(db_session, email="cara@example.com", name="Cara")

    response = get_my_requests(caller, db_session)

    assert response.pending == []
    assert response.approved == []
    assert response.denied == []


@pytest.mark.parametrize("other_status", ["completed", "cancelled"])
def test_my_requests_excludes_other_statuses(db_session, other_status):
    # Only pending, approved, and denied have sections. A claim in any other state
    # (completed, withdrawn) shows in none of them. A picked-up claim is the
    # exception: it stays in the approved section, covered by its own test below.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, status=other_status)

    response = get_my_requests(caller, db_session)

    assert response.pending == []
    assert response.approved == []
    assert response.denied == []


def test_my_requests_keeps_picked_up_in_approved(db_session):
    # Once the recipient confirms pickup, the claim moves to "picked_up" but stays
    # in the approved section so they can still see it (with the pickup line the
    # page renders). It carries the provider's name like the other rows.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Polly Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, status="picked_up")

    response = get_my_requests(caller, db_session)

    assert response.pending == []
    assert response.denied == []
    assert len(response.approved) == 1
    assert response.approved[0].status == "picked_up"
    assert response.approved[0].listing_title == "Lemons"
    assert response.approved[0].owner_name == "Polly Poster"


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
# try/except inside build_my_request_items.
class ListingReadFails:
    def __init__(self):
        self.id = uuid.uuid4()
        self.requested_quantity = 1
        self.requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        self.status = "requested"

    @property
    def listing(self):
        raise OperationalError("statement", {}, Exception("listing load failed"))


class ScalarsListStub:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class ListingReadFailsSession:
    # Every scalars call (pending, approved, denied) returns the same claim list,
    # so the first section build reaches the failing listing read.
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


# A claim whose listing relationship holds None, the shape left behind when a
# listing row was hard-deleted by hand. The build skips it.
class ClaimWithMissingListing:
    def __init__(self):
        self.id = uuid.uuid4()
        self.requested_quantity = 1
        self.requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        self.status = "requested"
        self.listing = None


def test_my_requests_skips_a_claim_whose_listing_is_missing():
    member = Member(
        id=uuid.uuid4(),
        name="Cara",
        email="cara@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    session = ListingReadFailsSession([ClaimWithMissingListing()])

    response = get_my_requests(member, session)

    assert response.pending == []
    assert response.approved == []
    assert response.denied == []


class PhotoReadFailsSession:
    # The four claim reads (pending, approved, denied, withdrawn) return the
    # claim list; the photos read that follows (the fifth scalars call) raises,
    # which must surface as a 503.
    def __init__(self, claims):
        self.claims = claims
        self.read_count = 0

    def scalars(self, *args, **kwargs):
        self.read_count = self.read_count + 1
        if self.read_count <= 4:
            return ScalarsListStub(self.claims)
        raise OperationalError("statement", {}, Exception("photo load failed"))

    def close(self, *args, **kwargs):
        pass


class FakeListingForClaim:
    def __init__(self):
        self.id = uuid.uuid4()
        self.title = "Apples"
        self.owner = None


class ClaimWithListing:
    def __init__(self):
        self.id = uuid.uuid4()
        self.requested_quantity = 1
        self.requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        self.status = "requested"
        self.approved_quantity = None
        self.approved_at = None
        self.picked_up_at = None
        self.denied_at = None
        self.cancelled_at = None
        self.listing = FakeListingForClaim()


def test_my_requests_returns_503_on_a_photo_read_error():
    member = Member(
        id=uuid.uuid4(),
        name="Cara",
        email="cara@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    session = PhotoReadFailsSession([ClaimWithListing()])

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


# --- deterministic ordering: ties break by id -------------------------------


def test_my_requests_pending_order_is_deterministic_when_requested_at_ties(db_session):
    # Two pending requests (on different listings) share a requested_at. They come
    # out newest-first with the claim id descending as the tiebreaker, so the
    # order is repeatable instead of arbitrary.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_one = insert_listing(db_session, poster, title="One")
    listing_two = insert_listing(db_session, poster, title="Two")
    tied_time = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    claim_one = insert_claim(db_session, listing_one, caller, requested_at=tied_time)
    claim_two = insert_claim(db_session, listing_two, caller, requested_at=tied_time)

    # Same requested_at, so break the tie by claim id descending.
    ids_desc = sorted([claim_one.id, claim_two.id], reverse=True)
    expected_ids = []
    for claim_id in ids_desc:
        expected_ids.append(str(claim_id))

    response = get_my_requests(caller, db_session)

    pending_ids = []
    for item in response.pending:
        pending_ids.append(item.id)
    assert pending_ids == expected_ids
