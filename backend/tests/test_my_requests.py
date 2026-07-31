# Tests for the my-requests endpoint: the caller's own requests, split into five
# sections (pending, approved, completed, denied, withdrawn), each newest-first
# with an id tiebreaker.
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
from app.models.review import Review
from app.routers.claim import get_my_requests
from tests.asgi_client import call_asgi_get


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
    picked_up_at=None,
    completed_at=None,
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
        picked_up_at=picked_up_at,
        completed_at=completed_at,
        denied_at=denied_at,
        cancelled_at=cancelled_at,
    )
    session.add(claim)
    session.commit()
    return claim


# --- US-33: each section pages on its own ------------------------------------


def insert_numbered_pending_claims(session, poster, caller, count):
    # count pending requests, each one minute newer than the last, on their own
    # listing titled "Pending 00", "Pending 01", ... Newest-first order is the
    # exact reverse of the numbering.
    for index in range(count):
        listing = insert_listing(session, poster, title="Pending " + str(index).zfill(2))
        insert_claim(
            session,
            listing,
            caller,
            requested_at=datetime(2026, 7, 1, 12, index, tzinfo=timezone.utc),
        )


def collect_listing_titles(items):
    titles = []
    for item in items:
        titles.append(item.listing_title)
    return titles


def test_my_requests_sections_default_to_page_one_and_twelve_rows(db_session):
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    insert_numbered_pending_claims(db_session, poster, caller, 14)

    response = get_my_requests(current_member=caller, session=db_session)

    assert response.pending.page == 1
    assert response.pending.page_size == 12
    assert response.pending.total == 14
    assert len(response.pending.items) == 12
    assert response.pending.items[0].listing_title == "Pending 13"
    # A section with nothing still reports its own page numbers and a zero total,
    # so the page can decide not to draw controls for it.
    assert response.completed.total == 0
    assert response.completed.items == []
    assert response.completed.page == 1


def test_my_requests_pages_one_section_without_moving_the_others(db_session):
    # The heart of the stacked-sections rule: pending goes to page 2 while every
    # other section stays on page 1 with its own first window.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    insert_numbered_pending_claims(db_session, poster, caller, 14)
    # Two denied requests, so the denied section has rows of its own to stay on.
    for index in range(2):
        denied_listing = insert_listing(db_session, poster, title="Denied " + str(index))
        insert_claim(
            db_session,
            denied_listing,
            caller,
            status="denied",
            denied_at=datetime(2026, 7, 3, 10, index, tzinfo=timezone.utc),
        )

    response = get_my_requests(pending_page=2, current_member=caller, session=db_session)

    assert response.pending.page == 2
    assert collect_listing_titles(response.pending.items) == ["Pending 01", "Pending 00"]
    # Untouched: still page 1, still showing its own rows.
    assert response.denied.page == 1
    assert response.denied.total == 2
    assert collect_listing_titles(response.denied.items) == ["Denied 1", "Denied 0"]


def test_my_requests_each_section_reads_its_own_page_param(db_session):
    # Five sections, five page numbers. Paging the completed section moves only
    # the completed window.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    insert_numbered_pending_claims(db_session, poster, caller, 3)
    for index in range(3):
        completed_listing = insert_listing(db_session, poster, title="Done " + str(index))
        insert_claim(
            db_session,
            completed_listing,
            caller,
            status="completed",
            approved_quantity=1,
            approved_at=datetime(2026, 7, 2, 10, index, tzinfo=timezone.utc),
            picked_up_at=datetime(2026, 7, 2, 11, index, tzinfo=timezone.utc),
            completed_at=datetime(2026, 7, 4, 10, index, tzinfo=timezone.utc),
        )

    response = get_my_requests(
        completed_page=2, page_size=2, current_member=caller, session=db_session
    )

    assert response.completed.page == 2
    assert response.completed.total == 3
    assert collect_listing_titles(response.completed.items) == ["Done 0"]
    assert response.pending.page == 1
    assert response.pending.total == 3
    assert len(response.pending.items) == 2


def test_my_requests_section_page_past_the_end_is_empty_with_the_true_total(db_session):
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    insert_numbered_pending_claims(db_session, poster, caller, 14)

    response = get_my_requests(pending_page=5, current_member=caller, session=db_session)

    assert response.pending.items == []
    assert response.pending.total == 14
    assert response.pending.page == 5


@pytest.mark.parametrize(
    "query_text",
    ["pending_page=0", "approved_page=0", "page_size=101", "page_size=0", "pending_page=abc"],
)
def test_my_requests_rejects_out_of_bounds_paging_with_422(db_session, query_text):
    # The bounds live on the query params, so this goes through the ASGI layer.
    from app.db import get_db_session
    from app.dependencies import get_current_member

    active_member = Member(name="X", email="x@example.com", password_hash="x", status="active")
    app.dependency_overrides[get_current_member] = lambda: active_member
    app.dependency_overrides[get_db_session] = lambda: db_session
    try:
        status_code, _ = call_asgi_get("/api/my-requests?" + query_text)
        assert status_code == 422
    finally:
        app.dependency_overrides.clear()


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

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.pending.items) == 1
    assert response.pending.items[0].listing_title == "Apples"
    assert response.pending.items[0].requested_quantity == 3
    assert response.pending.items[0].status == "requested"

    assert len(response.approved.items) == 1
    assert response.approved.items[0].listing_title == "Bananas"
    assert response.approved.items[0].requested_quantity == 5
    assert response.approved.items[0].approved_quantity == 2
    assert response.approved.items[0].approved_at is not None
    assert response.approved.items[0].status == "approved"

    assert len(response.denied.items) == 1
    assert response.denied.items[0].listing_title == "Cherries"
    assert response.denied.items[0].requested_quantity == 4
    assert response.denied.items[0].denied_at is not None
    assert response.denied.items[0].status == "denied"


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

    response = get_my_requests(current_member=caller, session=db_session)

    assert response.pending.items == []
    assert len(response.withdrawn.items) == 2
    assert response.withdrawn.items[0].listing_title == "Bananas"
    assert response.withdrawn.items[1].listing_title == "Apples"
    assert response.withdrawn.items[0].cancelled_at is not None
    assert response.withdrawn.items[0].status == "cancelled"


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

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.pending.items) == 2
    # Newest first, so the photo-less Bananas request comes before Apples.
    assert response.pending.items[0].listing_title == "Bananas"
    assert response.pending.items[0].photos == []
    assert response.pending.items[1].listing_title == "Apples"
    assert len(response.pending.items[1].photos) == 2
    assert response.pending.items[1].photos[0].id == str(first_photo.id)
    assert response.pending.items[1].photos[0].content_type == "image/png"
    assert response.pending.items[1].photos[0].position == 0
    assert response.pending.items[1].photos[1].id == str(second_photo.id)


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

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.pending.items) == 2
    assert response.pending.items[0].listing_title == "Newer"
    assert response.pending.items[1].listing_title == "Older"


def test_my_requests_scopes_to_the_caller(db_session):
    # Another member's request on the same listing is never in the caller's view.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    other = insert_member(db_session, email="other@example.com", name="Other")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, requested_quantity=2)
    insert_claim(db_session, listing, other, requested_quantity=5)

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.pending.items) == 1
    assert response.pending.items[0].requested_quantity == 2
    assert response.approved.items == []
    assert response.denied.items == []


def test_my_requests_all_sections_empty_when_no_requests(db_session):
    caller = insert_member(db_session, email="cara@example.com", name="Cara")

    response = get_my_requests(current_member=caller, session=db_session)

    assert response.pending.items == []
    assert response.approved.items == []
    assert response.completed.items == []
    assert response.denied.items == []


@pytest.mark.parametrize("other_status", ["completed", "cancelled"])
def test_my_requests_keeps_statuses_out_of_the_first_three_sections(db_session, other_status):
    # A completed or withdrawn claim never leaks into the pending, approved, or
    # denied sections; each has its own section. A picked-up claim is the
    # exception: it stays in the approved section, covered by its own test below.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, status=other_status)

    response = get_my_requests(current_member=caller, session=db_session)

    assert response.pending.items == []
    assert response.approved.items == []
    assert response.denied.items == []


def test_my_requests_completed_section_carries_the_exchange(db_session):
    # A completed exchange lands in the completed section with its lifecycle
    # timestamps and the provider's name, so the recipient can still see the
    # finished exchange after the poster marks it complete.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Polly Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    completed_at = datetime(2026, 7, 3, 10, 0, tzinfo=timezone.utc)
    insert_claim(
        db_session,
        listing,
        caller,
        requested_quantity=4,
        status="completed",
        approved_quantity=3,
        approved_at=datetime(2026, 7, 2, 10, 0, tzinfo=timezone.utc),
        picked_up_at=datetime(2026, 7, 3, 9, 0, tzinfo=timezone.utc),
        completed_at=completed_at,
    )

    response = get_my_requests(current_member=caller, session=db_session)

    assert response.pending.items == []
    assert response.approved.items == []
    assert len(response.completed.items) == 1
    assert response.completed.items[0].status == "completed"
    assert response.completed.items[0].listing_title == "Lemons"
    assert response.completed.items[0].owner_name == "Polly Poster"
    assert response.completed.items[0].approved_quantity == 3
    assert response.completed.items[0].completed_at == completed_at


def test_my_requests_completed_section_is_newest_first(db_session):
    # Two completed exchanges come out newest completion first.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    listing_older = insert_listing(db_session, poster, title="Apples")
    listing_newer = insert_listing(db_session, poster, title="Bananas")
    insert_claim(
        db_session,
        listing_older,
        caller,
        status="completed",
        completed_at=datetime(2026, 7, 2, 9, 0, tzinfo=timezone.utc),
    )
    insert_claim(
        db_session,
        listing_newer,
        caller,
        status="completed",
        completed_at=datetime(2026, 7, 3, 9, 0, tzinfo=timezone.utc),
    )

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.completed.items) == 2
    assert response.completed.items[0].listing_title == "Bananas"
    assert response.completed.items[1].listing_title == "Apples"


def test_my_requests_keeps_picked_up_in_approved(db_session):
    # Once the recipient confirms pickup, the claim moves to "picked_up" but stays
    # in the approved section so they can still see it (with the pickup line the
    # page renders). It carries the provider's name like the other rows.
    caller = insert_member(db_session, email="cara@example.com", name="Cara")
    poster = insert_member(db_session, email="poster@example.com", name="Polly Poster")
    listing = insert_listing(db_session, poster, title="Lemons")
    insert_claim(db_session, listing, caller, status="picked_up")

    response = get_my_requests(current_member=caller, session=db_session)

    assert response.pending.items == []
    assert response.denied.items == []
    assert len(response.approved.items) == 1
    assert response.approved.items[0].status == "picked_up"
    assert response.approved.items[0].listing_title == "Lemons"
    assert response.approved.items[0].owner_name == "Polly Poster"


# --- caller status gate -----------------------------------------------------


def test_my_requests_denies_suspended_caller(db_session):
    caller = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_my_requests(current_member=caller, session=db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail.lower()


def test_my_requests_denies_inactive_caller(db_session):
    caller = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_my_requests(current_member=caller, session=db_session)

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
        get_my_requests(current_member=member, session=broken_session)

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
    # Every scalars call (one per section window) returns the same claim list, so
    # the first section build reaches the failing listing read. scalar answers the
    # per-section COUNT query the paged route runs before each window, so the
    # route gets past counting and reaches the build it is being tested for.
    def __init__(self, claims):
        self.claims = claims

    def scalars(self, *args, **kwargs):
        return ScalarsListStub(self.claims)

    def scalar(self, *args, **kwargs):
        return len(self.claims)

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
        get_my_requests(current_member=member, session=session)

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

    response = get_my_requests(current_member=member, session=session)

    assert response.pending.items == []
    assert response.approved.items == []
    assert response.denied.items == []


class PhotoReadFailsSession:
    # The five claim reads (pending, approved, completed, denied, withdrawn)
    # return the claim list; the photos read that follows (the sixth scalars
    # call) raises, which must surface as a 503.
    def __init__(self, claims):
        self.claims = claims
        self.read_count = 0

    def scalars(self, *args, **kwargs):
        self.read_count = self.read_count + 1
        if self.read_count <= 5:
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
        self.completed_at = None
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
        get_my_requests(current_member=member, session=session)

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

    response = get_my_requests(current_member=caller, session=db_session)

    pending_ids = []
    for item in response.pending.items:
        pending_ids.append(item.id)
    assert pending_ids == expected_ids


# --- reviewed_by_me: the US-20 edit-or-leave label flag ----------------------


def insert_review_row(session, claim_id, reviewer, reviewee, reviewee_role, rating=4):
    now = datetime.now(timezone.utc)
    review = Review(
        claim_id=claim_id,
        reviewer_id=reviewer.id,
        reviewee_id=reviewee.id,
        reviewee_role=reviewee_role,
        rating=rating,
        body="",
        created_at=now,
        updated_at=now,
    )
    session.add(review)
    session.commit()
    return review.id


def test_completed_request_is_flagged_after_the_caller_reviews(db_session):
    """Once the caller reviews a completed exchange, its row carries
    reviewed_by_me = True so the page can offer the edit label."""
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    caller = insert_member(db_session, email="caller@example.com", name="Caller")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(
        db_session,
        listing,
        caller,
        status="completed",
        completed_at=datetime(2026, 7, 2, 12, 0, tzinfo=timezone.utc),
    )
    insert_review_row(db_session, claim.id, caller, owner, "listing_owner")

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.completed.items) == 1
    assert response.completed.items[0].reviewed_by_me is True


def test_completed_request_is_not_flagged_before_the_caller_reviews(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    caller = insert_member(db_session, email="caller@example.com", name="Caller")
    listing = insert_listing(db_session, owner)
    insert_claim(
        db_session,
        listing,
        caller,
        status="completed",
        completed_at=datetime(2026, 7, 2, 12, 0, tzinfo=timezone.utc),
    )

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.completed.items) == 1
    assert response.completed.items[0].reviewed_by_me is False


def test_the_other_partys_review_does_not_flag_the_callers_row(db_session):
    """Only the CALLER's own review counts: the owner's review of the caller
    must not make the caller's row read as already reviewed."""
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    caller = insert_member(db_session, email="caller@example.com", name="Caller")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(
        db_session,
        listing,
        caller,
        status="completed",
        completed_at=datetime(2026, 7, 2, 12, 0, tzinfo=timezone.utc),
    )
    insert_review_row(db_session, claim.id, owner, caller, "requestor")

    response = get_my_requests(current_member=caller, session=db_session)

    assert len(response.completed.items) == 1
    assert response.completed.items[0].reviewed_by_me is False
