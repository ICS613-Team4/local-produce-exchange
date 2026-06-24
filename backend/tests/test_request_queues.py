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
from app.models.member import Member
from app.routers.claim import get_request_queues


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
):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description="Ripe red tomatoes from the garden.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=total_quantity,
        remaining_quantity=remaining_quantity,
        pickup_window=Range(start, end, bounds="[)"),
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
        return ScalarsListStub(self.claims)

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
