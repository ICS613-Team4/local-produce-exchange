# Tests for the view-listing-details endpoint (US-07 / UC-07).
# Run from the project root with: npm run test:backend
# Most tests call the get_listing route function directly with the shared
# Postgres session from conftest.py and a seeded member. One test inspects the
# app's route table to prove the endpoint is wired with its auth and session
# dependencies, without making real HTTP calls.

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range

from app.db import get_db_session
from app.dependencies import get_current_member
from app.main import app
from app.models.listing import Listing
from app.models.member import Member
from app.routers.listing import get_listing


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
):
    # None stands in for the list and range defaults so a fresh value is built
    # each call (no shared mutable default). A caller can pass description=None
    # or category=None on purpose to test the null-to-empty coercion.
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
    session.add(listing)
    session.commit()
    return listing


# --- happy path (Scenario 1): an active listing returns its full details ---


def test_get_listing_returns_full_details_for_an_active_listing(db_session):
    member = insert_member(db_session, "active")
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    pickup_window = Range(start, end, bounds="[)")
    listing = insert_listing(
        db_session,
        member,
        title="Backyard Lemons",
        description="Sweet Meyer lemons.",
        category="Fruit",
        dietary_tags=["vegan", "vegetarian"],
        allergen_tags=["contains nuts"],
        total_quantity=6,
        remaining_quantity=4,
        pickup_window=pickup_window,
    )

    response = get_listing(str(listing.id), member, db_session)

    assert response.id == str(listing.id)
    assert response.owner_id == str(member.id)
    assert response.title == "Backyard Lemons"
    assert response.description == "Sweet Meyer lemons."
    assert response.category == "Fruit"
    assert response.total_quantity == 6
    assert response.remaining_quantity == 4
    assert response.dietary_tags == ["vegan", "vegetarian"]
    assert response.allergen_tags == ["contains nuts"]
    # The two pickup times are read back off the stored range. datetime equality
    # compares the instant, so the timezone representation does not have to match.
    assert response.pickup_start == start
    assert response.pickup_end == end
    assert response.status == "active"


# --- not found: unknown id, malformed id ---


def test_get_listing_unknown_id_returns_404(db_session):
    member = insert_member(db_session, "active")
    missing_id = str(uuid.uuid4())

    with pytest.raises(HTTPException) as raised_error:
        get_listing(missing_id, member, db_session)

    assert raised_error.value.status_code == 404
    assert "unavailable" in raised_error.value.detail


def test_get_listing_malformed_id_returns_404(db_session):
    member = insert_member(db_session, "active")

    with pytest.raises(HTTPException) as raised_error:
        get_listing("not-a-uuid", member, db_session)

    assert raised_error.value.status_code == 404
    assert "unavailable" in raised_error.value.detail


# --- Scenario 2: a listing that is no longer active is shown as unavailable ---


@pytest.mark.parametrize("inactive_status", ["claimed", "expired", "cancelled", "deactivated"])
def test_get_listing_inactive_returns_404(db_session, inactive_status):
    member = insert_member(db_session, "active")
    listing = insert_listing(db_session, member, status=inactive_status)

    with pytest.raises(HTTPException) as raised_error:
        get_listing(str(listing.id), member, db_session)

    assert raised_error.value.status_code == 404
    assert "unavailable" in raised_error.value.detail


# --- permission rule: a non-active acting member is denied with 403 ---


def test_get_listing_denies_a_suspended_member(db_session):
    member = insert_member(db_session, "suspended")
    listing_id = str(uuid.uuid4())

    with pytest.raises(HTTPException) as raised_error:
        get_listing(listing_id, member, db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail
    # The message must be about viewing, not create-listing's "create a listing".
    assert "cannot view listings" in raised_error.value.detail


def test_get_listing_denies_an_inactive_member(db_session):
    member = insert_member(db_session, "inactive")
    listing_id = str(uuid.uuid4())

    with pytest.raises(HTTPException) as raised_error:
        get_listing(listing_id, member, db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail
    assert "cannot view listings" in raised_error.value.detail


# --- nullable text columns are coerced to empty strings ---


def test_get_listing_coerces_null_text_to_empty_strings(db_session):
    member = insert_member(db_session, "active")
    listing = insert_listing(db_session, member, description=None, category=None)

    response = get_listing(str(listing.id), member, db_session)

    assert response.description == ""
    assert response.category == ""


# --- bad pickup windows are shown as unavailable ---


def test_get_listing_unbounded_pickup_window_returns_404(db_session):
    # The column is NOT NULL, so we cannot store a null window. An unbounded
    # range stores fine but reads back with one bound as None, which the route's
    # missing-bound guard treats as unavailable.
    member = insert_member(db_session, "active")
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    unbounded_window = Range(start, None, bounds="[)")
    listing = insert_listing(db_session, member, pickup_window=unbounded_window)

    with pytest.raises(HTTPException) as raised_error:
        get_listing(str(listing.id), member, db_session)

    assert raised_error.value.status_code == 404
    assert "unavailable" in raised_error.value.detail


def test_get_listing_equal_bound_pickup_window_returns_404(db_session):
    # An inclusive equal-bound range like [t, t] is non-empty and stores with
    # lower == upper == t (both non-None), so it slips past the missing-bound
    # check. The route's pickup_end <= pickup_start guard catches it.
    member = insert_member(db_session, "active")
    moment = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    equal_window = Range(moment, moment, bounds="[]")
    listing = insert_listing(db_session, member, pickup_window=equal_window)

    with pytest.raises(HTTPException) as raised_error:
        get_listing(str(listing.id), member, db_session)

    assert raised_error.value.status_code == 404
    assert "unavailable" in raised_error.value.detail


# --- database failure returns 503, not an unhandled error ---


def test_get_listing_returns_503_on_database_error(broken_session):
    # The member is active, so the gate passes; the broken session then raises
    # on the listing query, and the route turns that into a 503.
    member = Member(
        id=uuid.uuid4(),
        name="Viewer",
        email="viewer@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    some_id = str(uuid.uuid4())

    with pytest.raises(HTTPException) as raised_error:
        get_listing(some_id, member, broken_session)

    assert raised_error.value.status_code == 503


# --- route wiring: the GET route exists with its auth and session dependencies ---


def test_get_listing_route_is_wired_with_auth_and_session():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/listings/{listing_id}" and "GET" in route.methods:
                found_route = route
    assert found_route is not None

    # Collect the dependency callables the route declares. Both the auth
    # dependency and the session dependency must be present, so the test fails
    # if someone registers this route without authentication.
    dependency_calls = []
    for dependency in found_route.dependant.dependencies:
        dependency_calls.append(dependency.call)
    assert get_current_member in dependency_calls
    assert get_db_session in dependency_calls
