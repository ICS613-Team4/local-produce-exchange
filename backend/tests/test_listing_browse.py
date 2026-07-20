# Tests for the browse/search/filter listings endpoint (US-06 / UC-06).
# Run from the project root with: npm run test:backend
# Most tests call the browse_listings route function directly with the shared
# Postgres session from conftest.py and a seeded member. Two tests drive the app
# at the ASGI layer to prove the route is wired and that repeated tag query
# params bind as lists; they use a tiny hand-built ASGI GET helper instead of
# adding httpx just for this file.

import asyncio
import json
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range

from app.db import get_db_session
from app.dependencies import get_current_member
from app.main import app
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.models.review import Review
from app.routers.listing import browse_listings


def insert_member(session, status="active", email="viewer@example.com"):
    member = Member(
        name="Viewer",
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
    status="active",
    title="Fresh Tomatoes",
    description="Ripe red tomatoes from the garden.",
    category="Vegetables",
    dietary_tags=None,
    allergen_tags=None,
    total_quantity=5,
    remaining_quantity=5,
    pickup_window=None,
    created_at=None,
):
    # None stands in for the list and range defaults so a fresh value is built
    # each call (no shared mutable default). A caller can pass description=None
    # or category=None on purpose to test the null-to-empty coercion. created_at
    # defaults to None so the column's server default (now()) fills it; ordering
    # and limit tests pass distinct timezone-aware values so the sort cannot tie.
    if dietary_tags is None:
        dietary_tags = []
    if allergen_tags is None:
        allergen_tags = []
    if pickup_window is None:
        start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
        end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
        pickup_window = Range(start, end, bounds="[)")
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description=description,
        category=category,
        dietary_tags=dietary_tags,
        allergen_tags=allergen_tags,
        total_quantity=total_quantity,
        remaining_quantity=remaining_quantity,
        pickup_window=pickup_window,
        status=status,
    )
    # Only set created_at when the caller gave one. Setting the attribute to None
    # would try to write NULL and skip the server default, which the NOT NULL
    # column would reject.
    if created_at is not None:
        listing.created_at = created_at
    session.add(listing)
    session.commit()
    return listing


def collect_titles(items):
    # Pull the title out of each result item into a plain list, so the ordering
    # and membership assertions read clearly.
    titles = []
    for item in items:
        titles.append(item.title)
    return titles


async def call_asgi_get(path_with_query):
    # Drive the FastAPI app once for a GET request and collect the response
    # status and body. This builds a minimal ASGI HTTP scope by hand and calls
    # the app the way a server would, which avoids adding httpx just for the two
    # wiring/binding tests below. The caller sets app.dependency_overrides for
    # the auth and session dependencies before calling this.
    if "?" in path_with_query:
        raw_path, query_string = path_with_query.split("?", 1)
    else:
        raw_path = path_with_query
        query_string = ""

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": raw_path,
        "raw_path": raw_path.encode("utf-8"),
        "query_string": query_string.encode("utf-8"),
        "headers": [],
        "server": ("testserver", 80),
        "client": ("testclient", 12345),
    }

    received_messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        received_messages.append(message)

    await app(scope, receive, send)

    status_code = None
    body_bytes = b""
    for message in received_messages:
        if message["type"] == "http.response.start":
            status_code = message["status"]
        elif message["type"] == "http.response.body":
            body_bytes = body_bytes + message.get("body", b"")
    return status_code, body_bytes


# --- happy path (Scenario 1): newest-first ordering ---


def test_browse_returns_newest_first(db_session):
    member = insert_member(db_session, "active")
    insert_listing(
        db_session,
        member,
        title="Older",
        created_at=datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc),
    )
    insert_listing(
        db_session,
        member,
        title="Newer",
        created_at=datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc),
    )

    results = browse_listings(current_member=member, session=db_session)

    assert len(results) == 2
    assert results[0].title == "Newer"
    assert results[1].title == "Older"


def test_browse_carries_the_owner_name_and_photos(db_session):
    # Each browse row names its owner (so the card can show who posted it) and
    # carries the listing's photos ordered by position.
    member = insert_member(db_session, "active")
    listing = insert_listing(db_session, member, title="Photographed")
    db_session.add(
        ListingPhoto(
            listing_id=listing.id,
            content_type="image/png",
            image_bytes=b"png-bytes",
            position=0,
        )
    )
    db_session.commit()

    results = browse_listings(current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].owner_name == "Viewer"
    assert len(results[0].photos) == 1
    assert results[0].photos[0].content_type == "image/png"
    assert results[0].photos[0].position == 0


def test_browse_order_is_deterministic_when_timestamps_tie(db_session):
    """Listings that share a created_at break the tie by id, so the LIMIT window
    is stable even after an unrelated UPDATE to a listing row.

    This is the dashboard bug: several listings shared one created_at (every seed
    row gets the same now() inside one transaction), the order among the ties was
    arbitrary, and the LIMIT picked an arbitrary subset. Approving a request runs
    an UPDATE on a listing row, which reshuffled which subset showed. The id
    tiebreaker makes the order total, so the same rows show every time.
    """
    member = insert_member(db_session, "active")
    shared_created_at = datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc)
    listings = []
    for index in range(6):
        listing = insert_listing(
            db_session,
            member,
            title="Tie " + str(index),
            created_at=shared_created_at,
        )
        listings.append(listing)

    # The deterministic rule: same created_at, so newest-first ties break by id
    # descending. Postgres orders uuids the same way Python does (by their 128-bit
    # value), so this predicts the exact window.
    all_ids = []
    for listing in listings:
        all_ids.append(listing.id)
    ids_by_rule = sorted(all_ids, reverse=True)
    expected_top_three = []
    for index in range(3):
        expected_top_three.append(str(ids_by_rule[index]))

    first = browse_listings(limit=3, current_member=member, session=db_session)
    first_ids = []
    for item in first:
        first_ids.append(item.id)
    assert first_ids == expected_top_three

    # Update one listing row the way approving a request does (it lowers a
    # listing's remaining_quantity). The window must not move.
    listings[0].remaining_quantity = 1
    db_session.commit()

    second = browse_listings(limit=3, current_member=member, session=db_session)
    second_ids = []
    for item in second:
        second_ids.append(item.id)
    assert second_ids == first_ids


# --- active-only: a listing that is no longer active is left out ---


@pytest.mark.parametrize("inactive_status", ["claimed", "expired", "cancelled", "deactivated"])
def test_browse_excludes_inactive_listings(db_session, inactive_status):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Active one", status="active")
    insert_listing(db_session, member, title="Hidden one", status=inactive_status)

    results = browse_listings(current_member=member, session=db_session)

    titles = collect_titles(results)
    assert "Active one" in titles
    assert "Hidden one" not in titles


# --- search text matches title or description, case-insensitive ---


def test_browse_search_matches_title_case_insensitive(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Backyard Meyer Lemons", description="Citrus from the tree.")
    insert_listing(db_session, member, title="Fresh Tomatoes", description="Red and ripe.")

    # Lower-case "lemon" must still match the capitalized title "Lemons".
    results = browse_listings(q="lemon", current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].title == "Backyard Meyer Lemons"


def test_browse_search_matches_description_case_insensitive(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Mystery Box", description="Full of LEMON zest.")
    insert_listing(db_session, member, title="Tomatoes", description="Red and ripe.")

    results = browse_listings(q="lemon", current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].title == "Mystery Box"


# --- each filter on its own ---


def test_browse_filters_by_category(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Lemons", category="Fruit")
    insert_listing(db_session, member, title="Lettuce", category="Vegetables")

    results = browse_listings(category="Fruit", current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].title == "Lemons"


def test_browse_filters_by_dietary_tag(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="GF Squash", dietary_tags=["vegan", "gluten-free"])
    insert_listing(db_session, member, title="Plain", dietary_tags=["vegan"])

    results = browse_listings(dietary_tags=["gluten-free"], current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].title == "GF Squash"


def test_browse_filters_by_allergen_tag(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Banana Bread", allergen_tags=["contains wheat", "contains nuts"])
    insert_listing(db_session, member, title="Lemons", allergen_tags=[])

    results = browse_listings(allergen_tags=["contains nuts"], current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].title == "Banana Bread"


# --- combined filters are ANDed together ---


def test_browse_combines_filters_with_and(db_session):
    member = insert_member(db_session, "active")
    # Matches all three: search text, category, and the dietary tag.
    insert_listing(
        db_session,
        member,
        title="Sweet Lemons",
        description="Great for lemonade.",
        category="Fruit",
        dietary_tags=["vegan"],
    )
    # Right text and category, but missing the vegan tag.
    insert_listing(
        db_session,
        member,
        title="Sour Lemons",
        description="Great for lemonade.",
        category="Fruit",
        dietary_tags=[],
    )
    # Right text and tag, but wrong category.
    insert_listing(
        db_session,
        member,
        title="Lemon Cake",
        description="A lemon dessert.",
        category="Baked goods",
        dietary_tags=["vegan"],
    )

    results = browse_listings(
        q="lemon",
        category="Fruit",
        dietary_tags=["vegan"],
        current_member=member,
        session=db_session,
    )

    assert len(results) == 1
    assert results[0].title == "Sweet Lemons"


# --- Scenario 2: nothing matches returns an empty list ---


def test_browse_no_matches_returns_empty_list(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Lemons", category="Fruit")

    results = browse_listings(q="nothingmatchesthisxyz", current_member=member, session=db_session)

    assert results == []


# --- the limit is honored, newest first ---


def test_browse_honors_limit(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="A", created_at=datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc))
    insert_listing(db_session, member, title="B", created_at=datetime(2026, 2, 1, 9, 0, tzinfo=timezone.utc))
    insert_listing(db_session, member, title="C", created_at=datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc))

    results = browse_listings(limit=2, current_member=member, session=db_session)

    # Only two come back, and they are the two newest in newest-first order.
    assert len(results) == 2
    assert results[0].title == "C"
    assert results[1].title == "B"


# --- nullable text columns are coerced to empty strings ---


def test_browse_coerces_null_text_to_empty_strings(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="No text", description=None, category=None)

    results = browse_listings(current_member=member, session=db_session)

    assert len(results) == 1
    assert results[0].description == ""
    assert results[0].category == ""


# --- bad pickup windows are skipped, not 500 ---


def test_browse_skips_unbounded_pickup_window(db_session):
    member = insert_member(db_session, "active")
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    unbounded_window = Range(start, None, bounds="[)")
    insert_listing(db_session, member, title="Unbounded", pickup_window=unbounded_window)
    insert_listing(db_session, member, title="Good")

    results = browse_listings(current_member=member, session=db_session)

    titles = collect_titles(results)
    assert "Good" in titles
    assert "Unbounded" not in titles


def test_browse_skips_equal_bound_pickup_window(db_session):
    member = insert_member(db_session, "active")
    moment = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    equal_window = Range(moment, moment, bounds="[]")
    insert_listing(db_session, member, title="Equal", pickup_window=equal_window)
    insert_listing(db_session, member, title="Good")

    results = browse_listings(current_member=member, session=db_session)

    titles = collect_titles(results)
    assert "Good" in titles
    assert "Equal" not in titles


# --- permission rule: a non-active acting member is denied with 403 ---


def test_browse_denies_a_suspended_member(db_session):
    member = insert_member(db_session, "suspended")

    with pytest.raises(HTTPException) as raised_error:
        browse_listings(current_member=member, session=db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail
    assert "cannot view listings" in raised_error.value.detail


def test_browse_denies_an_inactive_member(db_session):
    member = insert_member(db_session, "inactive")

    with pytest.raises(HTTPException) as raised_error:
        browse_listings(current_member=member, session=db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail
    assert "cannot view listings" in raised_error.value.detail


# --- database failure returns 503, not an unhandled error ---


def test_browse_returns_503_on_database_error(broken_session):
    # The member is active, so the gate passes; the broken session then raises on
    # the listing query, and the route turns that into a 503.
    member = Member(
        id=uuid.uuid4(),
        name="Viewer",
        email="viewer@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        browse_listings(current_member=member, session=broken_session)

    assert raised_error.value.status_code == 503


# --- route wiring: GET /api/listings exists with its auth and session deps ---


def test_browse_route_is_wired_with_auth_and_session():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/listings" and "GET" in route.methods:
                found_route = route
    assert found_route is not None

    dependency_calls = []
    for dependency in found_route.dependant.dependencies:
        dependency_calls.append(dependency.call)
    assert get_current_member in dependency_calls
    assert get_db_session in dependency_calls


# --- repeated query params bind as lists (proven at the ASGI layer) ---


def test_repeated_dietary_tags_query_params_bind_as_lists(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Both dietary", dietary_tags=["vegan", "gluten-free"])
    insert_listing(db_session, member, title="One dietary", dietary_tags=["vegan"])

    # Override the auth and session dependencies so the ASGI request runs against
    # this test's transaction. The auth override returns a detached active member
    # so reading its status needs no database round trip.
    active_member = Member(name="X", email="x@example.com", password_hash="x", status="active")
    app.dependency_overrides[get_current_member] = lambda: active_member
    app.dependency_overrides[get_db_session] = lambda: db_session
    try:
        status_code, body_bytes = asyncio.run(
            call_asgi_get("/api/listings?dietary_tags=vegan&dietary_tags=gluten-free")
        )
        assert status_code == 200
        data = json.loads(body_bytes)
        titles = []
        for item in data:
            titles.append(item["title"])
        # If the two repeated params bound as a list, the @> filter requires both
        # tags, so only "Both dietary" matches. If they had wrongly bound as a
        # single value, "One dietary" would slip in too.
        assert titles == ["Both dietary"]
    finally:
        app.dependency_overrides.clear()


def test_repeated_allergen_tags_query_params_bind_as_lists(db_session):
    member = insert_member(db_session, "active")
    insert_listing(db_session, member, title="Both allergen", allergen_tags=["nuts", "wheat"])
    insert_listing(db_session, member, title="One allergen", allergen_tags=["nuts"])

    active_member = Member(name="X", email="x@example.com", password_hash="x", status="active")
    app.dependency_overrides[get_current_member] = lambda: active_member
    app.dependency_overrides[get_db_session] = lambda: db_session
    try:
        status_code, body_bytes = asyncio.run(
            call_asgi_get("/api/listings?allergen_tags=nuts&allergen_tags=wheat")
        )
        assert status_code == 200
        data = json.loads(body_bytes)
        titles = []
        for item in data:
            titles.append(item["title"])
        assert titles == ["Both allergen"]
    finally:
        app.dependency_overrides.clear()


# --- US-20: each card carries its owner's listing-owner rating ---------------


def test_browse_carries_each_owners_listing_owner_rating(db_session):
    """A rated owner's card carries the role-scoped average and count; an
    unrated owner's card carries None and 0 (shown as "No rating yet")."""
    rated_owner = insert_member(db_session, email="rated-owner@example.com")
    unrated_owner = insert_member(db_session, email="unrated-owner@example.com")
    rated_listing = insert_listing(db_session, rated_owner, title="Rated Tomatoes")
    insert_listing(db_session, unrated_owner, title="Unrated Kale")

    # One completed exchange on the rated owner's listing, reviewed 4 stars.
    reviewer = insert_member(db_session, email="reviewer@example.com")
    claim = Claim(
        listing_id=rated_listing.id,
        claimant_id=reviewer.id,
        requested_quantity=1,
        approved_quantity=1,
        status="completed",
        requested_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
    )
    db_session.add(claim)
    db_session.commit()
    now = datetime.now(timezone.utc)
    review = Review(
        claim_id=claim.id,
        reviewer_id=reviewer.id,
        reviewee_id=rated_owner.id,
        reviewee_role="listing_owner",
        rating=4,
        body="",
        created_at=now,
        updated_at=now,
    )
    db_session.add(review)
    db_session.commit()

    viewer = insert_member(db_session, email="viewer-two@example.com")
    results = browse_listings(current_member=viewer, session=db_session)

    items_by_title = {}
    for item in results:
        items_by_title[item.title] = item
    assert items_by_title["Rated Tomatoes"].owner_rating_average == 4.0
    assert items_by_title["Rated Tomatoes"].owner_rating_count == 1
    assert items_by_title["Unrated Kale"].owner_rating_average is None
    assert items_by_title["Unrated Kale"].owner_rating_count == 0
