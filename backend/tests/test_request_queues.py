# Tests for the request-queue endpoint (US-10 / UC-10).
# Run from the project root with:
# uv run --locked --all-groups --directory backend pytest tests/test_request_queues.py -v

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
from app.routers.claim import get_all_requests, get_request_queues


# Far-future and far-past pickup windows. The can_decide rule compares the
# listing's pickup-window end against the real clock, so these make the window
# check deterministic no matter when the suite runs: a window ending in 2999 has
# not ended, and one ending in 2000 has.
FUTURE_START = datetime(2999, 1, 1, 9, 0, tzinfo=timezone.utc)
FUTURE_END = datetime(2999, 1, 1, 11, 0, tzinfo=timezone.utc)
PAST_START = datetime(2000, 1, 1, 9, 0, tzinfo=timezone.utc)
PAST_END = datetime(2000, 1, 1, 11, 0, tzinfo=timezone.utc)


# These helpers follow the project convention that each test file owns its setup
# helpers. Issue #124 tracks folding the repeated insert_member and insert_listing
# builders into one shared place; this file adds another copy on purpose until
# then, so US-10 is not blocked on that optional refactor.
def insert_member(session, status="active", email="poster@example.com", name="Poster"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(
    session,
    owner,
    title="Fresh Tomatoes",
    status="active",
    total_quantity=5,
    remaining_quantity=5,
    created_at=None,
    pickup_start=None,
    pickup_end=None,
):
    # The pickup window defaults to a fixed July 2026 range. A can_decide test
    # that needs a window known to be open or closed passes its own bounds.
    if pickup_start is None:
        pickup_start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    if pickup_end is None:
        pickup_end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description="Ripe red tomatoes from the garden.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=total_quantity,
        remaining_quantity=remaining_quantity,
        pickup_window=Range(pickup_start, pickup_end, bounds="[)"),
        status=status,
    )
    # The model fills created_at with the server default now() when it is not
    # set. In a single test transaction now() is the same for every insert, so a
    # test that needs distinct created_at values passes them in explicitly.
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


def test_request_queues_happy_path(db_session):
    # An owner with two listings: one has two pending claims at different times,
    # the other has none. The response has a single group, the claims are
    # oldest-first, and the names, quantities, and remaining quantity are right.
    owner = insert_member(db_session, email="owner@example.com")
    ann = insert_member(db_session, email="ann@example.com", name="Ann")
    ben = insert_member(db_session, email="ben@example.com", name="Ben")
    lemons = insert_listing(db_session, owner, title="Lemons", total_quantity=24, remaining_quantity=24)
    insert_listing(db_session, owner, title="Eggs", total_quantity=3, remaining_quantity=3)

    older_time = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    # Insert the newer claim first, so a pass proves the route orders by
    # requested_at and not by insertion order.
    insert_claim(db_session, lemons, ben, requested_quantity=2, requested_at=newer_time)
    insert_claim(db_session, lemons, ann, requested_quantity=3, requested_at=older_time)

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 1
    group = response.groups[0]
    assert group.listing_id == str(lemons.id)
    assert group.listing_title == "Lemons"
    assert group.listing_status == "active"
    assert group.remaining_quantity == 24
    assert len(group.pending) == 2
    # Oldest first: Ann's older request, then Ben's newer one.
    assert group.pending[0].claimant_name == "Ann"
    assert group.pending[0].requested_quantity == 3
    assert group.pending[1].claimant_name == "Ben"
    assert group.pending[1].requested_quantity == 2


def test_request_queues_groups_ordered_by_listing_created_at_desc(db_session):
    # Two listings with pending claims come back newest-listing first (created_at
    # descending). The titles are chosen so the date order differs from
    # alphabetical order, proving it is the date that orders the groups.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    older_time = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    # Apples is the older listing; Zucchini is the newer one. Alphabetical order
    # would put Apples first, but newest-first puts Zucchini first.
    apples = insert_listing(db_session, owner, title="Apples", created_at=older_time)
    zucchini = insert_listing(db_session, owner, title="Zucchini", created_at=newer_time)
    insert_claim(db_session, apples, cara)
    insert_claim(db_session, zucchini, cara)

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 2
    assert response.groups[0].listing_title == "Zucchini"
    assert response.groups[1].listing_title == "Apples"


# --- empty and scoping ------------------------------------------------------


def test_request_queues_empty_when_no_pending(db_session):
    # The owner has listings but no pending claims, so the response is empty.
    owner = insert_member(db_session, email="owner@example.com")
    insert_listing(db_session, owner, title="Lemons")

    response = get_request_queues(None, owner, db_session)

    assert response.groups == []


def test_request_queues_scopes_to_the_caller(db_session):
    # A second owner's pending claims never appear in the first owner's response.
    owner = insert_member(db_session, email="owner@example.com")
    other_owner = insert_member(db_session, email="other@example.com", name="Other")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    my_listing = insert_listing(db_session, owner, title="Mine")
    their_listing = insert_listing(db_session, other_owner, title="Theirs")
    insert_claim(db_session, my_listing, cara)
    insert_claim(db_session, their_listing, cara)

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_title == "Mine"


# --- status filter ----------------------------------------------------------


@pytest.mark.parametrize(
    "excluded_status",
    ["approved", "picked_up", "completed", "cancelled", "denied"],
)
def test_request_queues_excludes_non_requested_status(db_session, excluded_status):
    # Only a "requested" claim is pending. Every other status is left out, so a
    # listing whose only claim is non-requested produces no group.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(db_session, owner, title="Lemons")
    insert_claim(db_session, listing, cara, status=excluded_status)

    response = get_request_queues(None, owner, db_session)

    assert response.groups == []


def test_request_queues_counts_only_requested_among_mixed(db_session):
    # With one requested and one approved claim on the same listing, only the
    # requested one shows in the queue.
    owner = insert_member(db_session, email="owner@example.com")
    pat = insert_member(db_session, email="pat@example.com", name="Pat")
    amy = insert_member(db_session, email="amy@example.com", name="Amy")
    listing = insert_listing(db_session, owner, title="Lemons")
    insert_claim(db_session, listing, pat, requested_quantity=4, status="requested")
    insert_claim(db_session, listing, amy, requested_quantity=5, status="approved")

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 1
    assert len(response.groups[0].pending) == 1
    assert response.groups[0].pending[0].claimant_name == "Pat"
    assert response.groups[0].pending[0].requested_quantity == 4


# --- deactivated listing (US-17 note) ---------------------------------------


def test_request_queues_includes_deactivated_listing(db_session):
    # A listing the poster deactivated still shows its pending requests, labeled
    # by its status so the frontend can mark it "(deactivated)".
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(db_session, owner, title="Lemons", status="deactivated")
    insert_claim(db_session, listing, cara)

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_status == "deactivated"
    assert len(response.groups[0].pending) == 1


# --- filtered single-listing query ------------------------------------------


def test_request_queues_filtered_owned_with_pending_returns_one_group(db_session):
    # With ?listing=<owned id>, only that listing's queue comes back, even when
    # the owner has another listing with pending claims.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    lemons = insert_listing(db_session, owner, title="Lemons")
    eggs = insert_listing(db_session, owner, title="Eggs")
    insert_claim(db_session, lemons, cara)
    insert_claim(db_session, eggs, cara)

    response = get_request_queues(str(lemons.id), owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_title == "Lemons"


def test_request_queues_filtered_owned_no_pending_returns_empty(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    listing = insert_listing(db_session, owner, title="Lemons")

    response = get_request_queues(str(listing.id), owner, db_session)

    assert response.groups == []


def test_request_queues_filtered_malformed_id_returns_empty(db_session):
    owner = insert_member(db_session, email="owner@example.com")

    response = get_request_queues("not-a-uuid", owner, db_session)

    assert response.groups == []


def test_request_queues_filtered_unknown_id_returns_empty(db_session):
    owner = insert_member(db_session, email="owner@example.com")

    response = get_request_queues(str(uuid.uuid4()), owner, db_session)

    assert response.groups == []


def test_request_queues_filtered_foreign_listing_returns_403(db_session):
    # Scenario 3: a member asking for another member's listing queue is denied,
    # and no queue rows leak.
    owner = insert_member(db_session, email="owner@example.com")
    other_owner = insert_member(db_session, email="other@example.com", name="Other")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    their_listing = insert_listing(db_session, other_owner, title="Theirs")
    insert_claim(db_session, their_listing, cara)

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(str(their_listing.id), owner, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "You can only view requests for your own listings."


# --- caller status gate -----------------------------------------------------


def test_request_queues_denies_suspended_caller(db_session):
    caller = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(None, caller, db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail.lower()


def test_request_queues_denies_inactive_caller(db_session):
    caller = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(None, caller, db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail.lower()


# --- database failures -------------------------------------------------------


def test_request_queues_returns_503_on_listing_load_error(broken_session):
    # The no-filter listings query fails, so the route returns 503.
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(None, member, broken_session)

    assert raised_error.value.status_code == 503


def test_request_queues_returns_503_on_filtered_listing_load_error(broken_session):
    # The single-listing query fails on the filtered path, so the route returns 503.
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(str(uuid.uuid4()), member, broken_session)

    assert raised_error.value.status_code == 503


# A tiny stand-in for session.scalars(...) that returns a fixed list.
class ScalarsListStub:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows

    def first(self):
        if len(self.rows) == 0:
            return None
        return self.rows[0]


# A session whose first scalars call (listings) succeeds but whose second call
# (the per-listing claim query) fails, so the test reaches the claim-query
# try/except that the listing-load failure never gets to.
class ClaimQueryFailsSession:
    def __init__(self, listings):
        self.listings = listings
        self.scalars_calls = 0

    def scalars(self, *args, **kwargs):
        self.scalars_calls = self.scalars_calls + 1
        if self.scalars_calls == 1:
            return ScalarsListStub(self.listings)
        raise OperationalError("statement", {}, Exception("claim query failed"))

    def close(self, *args, **kwargs):
        pass


def test_request_queues_returns_503_on_claim_query_error():
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    # Only id is read before the claim query runs, so a detached listing is enough.
    listing = Listing(
        id=uuid.uuid4(),
        owner_id=member.id,
        title="Lemons",
        status="active",
        remaining_quantity=5,
    )
    session = ClaimQueryFailsSession([listing])

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(None, member, session)

    assert raised_error.value.status_code == 503


# Stands in for a Claim row whose claimant relationship read fails, so the test
# reaches the claimant-name try/except.
class ClaimantReadFails:
    def __init__(self):
        self.id = uuid.uuid4()
        self.claimant_id = uuid.uuid4()
        self.requested_quantity = 1
        self.requested_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)

    @property
    def claimant(self):
        raise OperationalError("statement", {}, Exception("claimant load failed"))


# A session whose listings query and claim query both succeed, but the claim it
# returns fails when its claimant name is read.
class ClaimantNameFailsSession:
    def __init__(self, listings, claims):
        self.listings = listings
        self.claims = claims
        self.scalars_calls = 0

    def scalars(self, *args, **kwargs):
        self.scalars_calls = self.scalars_calls + 1
        if self.scalars_calls == 1:
            return ScalarsListStub(self.listings)
        # The second scalars call on the all-requests path is the batched
        # photo read; answer it with no photos so the flow reaches the
        # claimant read this fake is built to fail.
        if self.scalars_calls == 2:
            return ScalarsListStub([])
        return ScalarsListStub(self.claims)

    def execute(self, *args, **kwargs):
        raise OperationalError("statement", {}, Exception("claimant load failed"))

    def close(self, *args, **kwargs):
        pass


def test_request_queues_returns_503_on_claimant_name_error():
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    listing = Listing(
        id=uuid.uuid4(),
        owner_id=member.id,
        title="Lemons",
        status="active",
        remaining_quantity=5,
    )
    failing_claim = ClaimantReadFails()
    session = ClaimantNameFailsSession([listing], [failing_claim])

    with pytest.raises(HTTPException) as raised_error:
        get_request_queues(None, member, session)

    assert raised_error.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_request_queues_route_is_wired_with_get_method():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/request-queues" and "GET" in route.methods:
                found_route = route
    assert found_route is not None


# --- deterministic ordering: ties break by id -------------------------------


def test_queue_pending_order_is_deterministic_when_requested_at_ties(db_session):
    # Two pending claims with the SAME requested_at must come out in a stable
    # order. The queue breaks the tie by claim id ascending, so the order is
    # repeatable instead of arbitrary.
    owner = insert_member(db_session, email="owner@example.com")
    listing = insert_listing(db_session, owner)
    ann = insert_member(db_session, email="ann@example.com", name="Ann")
    bob = insert_member(db_session, email="bob@example.com", name="Bob")
    tied_time = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    claim_ann = insert_claim(db_session, listing, ann, requested_at=tied_time)
    claim_bob = insert_claim(db_session, listing, bob, requested_at=tied_time)

    # The rule: same requested_at, so break the tie by claim id ascending.
    ids_sorted = sorted([claim_ann.id, claim_bob.id])
    expected_ids = []
    for claim_id in ids_sorted:
        expected_ids.append(str(claim_id))

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 1
    pending_ids = []
    for item in response.groups[0].pending:
        pending_ids.append(item.id)
    assert pending_ids == expected_ids


def test_queue_group_order_is_deterministic_when_created_at_ties(db_session):
    # Two of the owner's listings share a created_at and each has a pending
    # claim. The groups must come out in a stable order: newest-first, with the
    # listing id descending as the tiebreaker.
    owner = insert_member(db_session, email="owner@example.com")
    tied_time = datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc)
    listing_one = insert_listing(db_session, owner, title="One", created_at=tied_time)
    listing_two = insert_listing(db_session, owner, title="Two", created_at=tied_time)
    ann = insert_member(db_session, email="ann@example.com", name="Ann")
    bob = insert_member(db_session, email="bob@example.com", name="Bob")
    insert_claim(db_session, listing_one, ann)
    insert_claim(db_session, listing_two, bob)

    # The rule: same created_at, so break the tie by listing id descending.
    listing_ids_desc = sorted([listing_one.id, listing_two.id], reverse=True)
    expected_listing_ids = []
    for listing_id in listing_ids_desc:
        expected_listing_ids.append(str(listing_id))

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 2
    group_listing_ids = []
    for group in response.groups:
        group_listing_ids.append(group.listing_id)
    assert group_listing_ids == expected_listing_ids


# --- can_decide on the pending queue (US-24) ---------------------------------


def test_request_queues_can_decide_true_for_normal_pending(db_session):
    # A pending request on an active listing with quantity left and an open
    # pickup window can be decided, so can_decide is True.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_request_queues(None, owner, db_session)

    assert response.groups[0].pending[0].can_decide is True
    assert response.groups[0].pending[0].can_deny is True


def test_request_queues_can_decide_false_on_deactivated_listing(db_session):
    # A pending request on a deactivated listing is still returned (so the poster
    # sees it), but it cannot be decided, so can_decide is False.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session,
        owner,
        status="deactivated",
        pickup_start=FUTURE_START,
        pickup_end=FUTURE_END,
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_request_queues(None, owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].pending[0].can_decide is False
    # A deactivated listing takes no decisions at all, so deny is hidden too.
    assert response.groups[0].pending[0].can_deny is False


def test_request_queues_can_decide_false_when_claimant_suspended(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, status="suspended", email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_request_queues(None, owner, db_session)

    assert response.groups[0].pending[0].can_decide is False
    assert response.groups[0].pending[0].can_deny is False


def test_request_queues_can_decide_false_when_pickup_window_passed(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=PAST_START, pickup_end=PAST_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_request_queues(None, owner, db_session)

    assert response.groups[0].pending[0].can_decide is False
    assert response.groups[0].pending[0].can_deny is False


def test_request_queues_can_deny_true_when_no_remaining_quantity(db_session):
    # The bug fix: a pending request on an active listing with no remaining
    # quantity cannot be approved (nothing to give), so can_decide is False, but
    # it CAN still be denied, so can_deny is True. Without this, the owner would
    # have no way to clear the request once the listing was fully allocated.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=0, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_request_queues(None, owner, db_session)

    assert response.groups[0].pending[0].can_decide is False
    assert response.groups[0].pending[0].can_deny is True


def test_request_queues_can_decide_false_when_pickup_window_has_no_end(db_session):
    # A listing whose pickup window has no upper bound cannot have its window
    # confirmed open, so the can_decide guard returns False. This exercises the
    # defensive branch for a malformed (unbounded) window.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(db_session, owner, remaining_quantity=5)
    # Replace the window with an unbounded-upper range (a start, but no end).
    listing.pickup_window = Range(FUTURE_START, None, bounds="[)")
    db_session.commit()
    insert_claim(db_session, listing, cara, status="requested")

    response = get_request_queues(None, owner, db_session)

    assert response.groups[0].pending[0].can_decide is False


# --- all-requests endpoint (US-24): full per-listing history -----------------


def test_all_requests_happy_path_active_listings_grouped(db_session):
    # The caller's active listings come back grouped, newest-listing first, with
    # the requests inside each listing oldest-first.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    older_time = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    apples = insert_listing(db_session, owner, title="Apples", created_at=older_time)
    zucchini = insert_listing(db_session, owner, title="Zucchini", created_at=newer_time)
    insert_claim(db_session, apples, cara)
    insert_claim(db_session, zucchini, cara)

    response = get_all_requests(None, owner, db_session)

    assert len(response.groups) == 2
    assert response.groups[0].listing_title == "Zucchini"
    assert response.groups[1].listing_title == "Apples"


def test_all_requests_carries_each_listing_photos(db_session):
    # Each group carries its listing's photos ordered by position, so the page
    # can show the cover photo. A photo-less listing gets an empty list.
    owner = insert_member(db_session, email="owner@example.com")
    photographed = insert_listing(db_session, owner, title="Apples")
    insert_listing(
        db_session,
        owner,
        title="Zucchini",
        created_at=datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
    )
    photo = ListingPhoto(
        listing_id=photographed.id,
        content_type="image/png",
        image_bytes=b"png-bytes",
        position=0,
    )
    db_session.add(photo)
    db_session.commit()

    response = get_all_requests(None, owner, db_session)

    groups_by_title = {}
    for group in response.groups:
        groups_by_title[group.listing_title] = group
    assert len(groups_by_title["Apples"].photos) == 1
    assert groups_by_title["Apples"].photos[0].id == str(photo.id)
    assert groups_by_title["Apples"].photos[0].content_type == "image/png"
    assert groups_by_title["Zucchini"].photos == []
    # Each group also names when its listing was posted.
    assert groups_by_title["Apples"].created_at is not None
    assert groups_by_title["Zucchini"].created_at is not None


@pytest.mark.parametrize(
    "claim_status",
    ["requested", "approved", "denied", "cancelled", "picked_up", "completed"],
)
def test_all_requests_includes_every_status(db_session, claim_status):
    # Unlike the pending queue, this view shows a claim of any status.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(db_session, owner, title="Lemons")
    insert_claim(db_session, listing, cara, status=claim_status)

    response = get_all_requests(None, owner, db_session)

    assert len(response.groups) == 1
    assert len(response.groups[0].requests) == 1
    assert response.groups[0].requests[0].status == claim_status


def test_all_requests_excludes_deactivated_listing(db_session):
    # A deactivated listing is dropped entirely, even if it has requests.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    active = insert_listing(db_session, owner, title="Active", status="active")
    deactivated = insert_listing(db_session, owner, title="Down", status="deactivated")
    insert_claim(db_session, active, cara)
    insert_claim(db_session, deactivated, cara)

    response = get_all_requests(None, owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_title == "Active"


def test_all_requests_excludes_other_members(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    other = insert_member(db_session, email="other@example.com", name="Other")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    mine = insert_listing(db_session, owner, title="Mine")
    theirs = insert_listing(db_session, other, title="Theirs")
    insert_claim(db_session, mine, cara)
    insert_claim(db_session, theirs, cara)

    response = get_all_requests(None, owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_title == "Mine"


def test_all_requests_includes_active_listing_with_no_requests(db_session):
    # An active listing with zero requests is kept as an empty group, so the
    # page can show its listing-level empty note.
    owner = insert_member(db_session, email="owner@example.com")
    insert_listing(db_session, owner, title="Empty", status="active")

    response = get_all_requests(None, owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_title == "Empty"
    assert response.groups[0].requests == []


def test_all_requests_orders_requests_oldest_first(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    ann = insert_member(db_session, email="ann@example.com", name="Ann")
    ben = insert_member(db_session, email="ben@example.com", name="Ben")
    listing = insert_listing(db_session, owner, title="Lemons")
    older_time = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    # Insert the newer one first, so a pass proves the route orders by date.
    insert_claim(db_session, listing, ben, requested_at=newer_time)
    insert_claim(db_session, listing, ann, requested_at=older_time)

    response = get_all_requests(None, owner, db_session)

    requests = response.groups[0].requests
    assert requests[0].claimant_name == "Ann"
    assert requests[1].claimant_name == "Ben"


def test_all_requests_listing_order_tiebreak_by_id_desc(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    tied_time = datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc)
    listing_one = insert_listing(db_session, owner, title="One", created_at=tied_time)
    listing_two = insert_listing(db_session, owner, title="Two", created_at=tied_time)

    listing_ids_desc = sorted([listing_one.id, listing_two.id], reverse=True)
    expected_listing_ids = []
    for listing_id in listing_ids_desc:
        expected_listing_ids.append(str(listing_id))

    response = get_all_requests(None, owner, db_session)

    group_listing_ids = []
    for group in response.groups:
        group_listing_ids.append(group.listing_id)
    assert group_listing_ids == expected_listing_ids


def test_all_requests_request_order_tiebreak_by_id_asc(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    listing = insert_listing(db_session, owner)
    ann = insert_member(db_session, email="ann@example.com", name="Ann")
    bob = insert_member(db_session, email="bob@example.com", name="Bob")
    tied_time = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    claim_ann = insert_claim(db_session, listing, ann, requested_at=tied_time)
    claim_bob = insert_claim(db_session, listing, bob, requested_at=tied_time)

    ids_sorted = sorted([claim_ann.id, claim_bob.id])
    expected_ids = []
    for claim_id in ids_sorted:
        expected_ids.append(str(claim_id))

    response = get_all_requests(None, owner, db_session)

    request_ids = []
    for item in response.groups[0].requests:
        request_ids.append(item.id)
    assert request_ids == expected_ids


# --- all-requests can_decide -------------------------------------------------


def test_all_requests_can_decide_true_for_normal_pending(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_all_requests(None, owner, db_session)

    assert response.groups[0].requests[0].can_decide is True


def test_all_requests_can_decide_false_when_not_pending(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="denied")

    response = get_all_requests(None, owner, db_session)

    assert response.groups[0].requests[0].can_decide is False


def test_all_requests_can_decide_false_when_claimant_suspended(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, status="suspended", email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_all_requests(None, owner, db_session)

    assert response.groups[0].requests[0].can_decide is False


def test_all_requests_can_decide_false_when_pickup_window_passed(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=PAST_START, pickup_end=PAST_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_all_requests(None, owner, db_session)

    assert response.groups[0].requests[0].can_decide is False


def test_all_requests_can_decide_false_when_no_remaining_quantity(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=0, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="requested")

    response = get_all_requests(None, owner, db_session)

    assert response.groups[0].requests[0].can_decide is False
    # Same fix as the pending queue: deny stays available with no remaining stock.
    assert response.groups[0].requests[0].can_deny is True


def test_all_requests_can_deny_false_when_not_pending(db_session):
    # A decided (denied) request can be neither approved nor denied again.
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    listing = insert_listing(
        db_session, owner, remaining_quantity=5, pickup_start=FUTURE_START, pickup_end=FUTURE_END
    )
    insert_claim(db_session, listing, cara, status="denied")

    response = get_all_requests(None, owner, db_session)

    assert response.groups[0].requests[0].can_decide is False
    assert response.groups[0].requests[0].can_deny is False


# --- all-requests filtered single-listing query ------------------------------


def test_all_requests_filtered_owned_active_returns_one_group(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    cara = insert_member(db_session, email="cara@example.com", name="Cara")
    lemons = insert_listing(db_session, owner, title="Lemons")
    eggs = insert_listing(db_session, owner, title="Eggs")
    insert_claim(db_session, lemons, cara)
    insert_claim(db_session, eggs, cara)

    response = get_all_requests(str(lemons.id), owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].listing_title == "Lemons"


def test_all_requests_filtered_owned_active_no_requests_returns_empty_group(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    listing = insert_listing(db_session, owner, title="Lemons")

    response = get_all_requests(str(listing.id), owner, db_session)

    assert len(response.groups) == 1
    assert response.groups[0].requests == []


def test_all_requests_filtered_malformed_id_returns_no_groups(db_session):
    owner = insert_member(db_session, email="owner@example.com")

    response = get_all_requests("not-a-uuid", owner, db_session)

    assert response.groups == []


def test_all_requests_filtered_unknown_id_returns_no_groups(db_session):
    owner = insert_member(db_session, email="owner@example.com")

    response = get_all_requests(str(uuid.uuid4()), owner, db_session)

    assert response.groups == []


def test_all_requests_filtered_owned_deactivated_returns_no_groups(db_session):
    # An owned listing that is not active shows nothing here, even though the
    # caller owns it: this endpoint only shows active listings.
    owner = insert_member(db_session, email="owner@example.com")
    deactivated = insert_listing(db_session, owner, title="Down", status="deactivated")

    response = get_all_requests(str(deactivated.id), owner, db_session)

    assert response.groups == []


def test_all_requests_filtered_foreign_listing_returns_403(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    other_owner = insert_member(db_session, email="other@example.com", name="Other")
    their_listing = insert_listing(db_session, other_owner, title="Theirs")

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(str(their_listing.id), owner, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "You can only view requests for your own listings."


# --- all-requests caller status gate -----------------------------------------


def test_all_requests_denies_suspended_caller(db_session):
    caller = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(None, caller, db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail.lower()


def test_all_requests_denies_inactive_caller(db_session):
    caller = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(None, caller, db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail.lower()


# --- all-requests database failures ------------------------------------------


def test_all_requests_returns_503_on_listing_load_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(None, member, broken_session)

    assert raised_error.value.status_code == 503


def test_all_requests_returns_503_on_filtered_listing_load_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(str(uuid.uuid4()), member, broken_session)

    assert raised_error.value.status_code == 503


def test_all_requests_returns_503_on_claim_query_error():
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    listing = Listing(
        id=uuid.uuid4(),
        owner_id=member.id,
        title="Lemons",
        status="active",
        remaining_quantity=5,
    )
    session = ClaimQueryFailsSession([listing])

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(None, member, session)

    assert raised_error.value.status_code == 503


def test_all_requests_returns_503_on_claimant_name_error():
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    listing = Listing(
        id=uuid.uuid4(),
        owner_id=member.id,
        title="Lemons",
        status="active",
        remaining_quantity=5,
    )
    failing_claim = ClaimantReadFails()
    session = ClaimantNameFailsSession([listing], [failing_claim])

    with pytest.raises(HTTPException) as raised_error:
        get_all_requests(None, member, session)

    assert raised_error.value.status_code == 503


# --- all-requests route wiring -----------------------------------------------


def test_all_requests_route_is_wired_with_get_method():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/request-queues/all" and "GET" in route.methods:
                found_route = route
    assert found_route is not None
