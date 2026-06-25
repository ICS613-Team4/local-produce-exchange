# Tests for the my-listings endpoint (US-24).
# Run from the project root with:
# uv run --locked --all-groups --directory backend pytest tests/test_my_listings.py -v

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range

from app.main import app
from app.models.listing import Listing
from app.models.member import Member
from app.routers.listing import get_my_listings


# This file owns its setup helpers, the same convention the other test files use.
def insert_member(session, status="active", role="member", email="owner@example.com", name="Owner"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status=status,
        role=role,
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
    deactivated_by=None,
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
        deactivated_by=deactivated_by,
    )
    # The model fills created_at with now() when it is not set. In a single test
    # transaction now() is the same for every insert, so a test that needs
    # distinct created_at values passes them in explicitly.
    if created_at is not None:
        listing.created_at = created_at
    session.add(listing)
    session.commit()
    return listing


# --- scope and ordering -----------------------------------------------------


def test_my_listings_returns_active_and_deactivated_for_caller(db_session):
    # The page manages both active and deactivated listings, so both come back.
    owner = insert_member(db_session, email="owner@example.com")
    insert_listing(db_session, owner, title="Active", status="active")
    insert_listing(db_session, owner, title="Down", status="deactivated")

    response = get_my_listings(owner, db_session)

    titles = []
    for item in response:
        titles.append(item.title)
    assert len(response) == 2
    assert "Active" in titles
    assert "Down" in titles


def test_my_listings_excludes_other_members(db_session):
    # Another member's listing never appears in the caller's list.
    owner = insert_member(db_session, email="owner@example.com")
    other = insert_member(db_session, email="other@example.com", name="Other")
    insert_listing(db_session, owner, title="Mine")
    insert_listing(db_session, other, title="Theirs")

    response = get_my_listings(owner, db_session)

    assert len(response) == 1
    assert response[0].title == "Mine"


def test_my_listings_ordered_created_at_desc_then_id_desc(db_session):
    # Newest created_at first, with the id breaking a tie. The two tied rows
    # share a created_at, so they prove the id-descending tiebreaker.
    owner = insert_member(db_session, email="owner@example.com")
    older_time = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
    newer_time = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    tied_time = datetime(2026, 6, 3, 9, 0, tzinfo=timezone.utc)
    older = insert_listing(db_session, owner, title="Older", created_at=older_time)
    newer = insert_listing(db_session, owner, title="Newer", created_at=newer_time)
    tied_one = insert_listing(db_session, owner, title="TiedOne", created_at=tied_time)
    tied_two = insert_listing(db_session, owner, title="TiedTwo", created_at=tied_time)

    response = get_my_listings(owner, db_session)

    ids_in_order = []
    for item in response:
        ids_in_order.append(item.id)
    # The two newest (tied) rows come first, ordered by id descending, then the
    # newer single row, then the older one.
    tied_ids_desc = sorted([str(tied_one.id), str(tied_two.id)], reverse=True)
    assert ids_in_order[0] == tied_ids_desc[0]
    assert ids_in_order[1] == tied_ids_desc[1]
    assert ids_in_order[2] == str(newer.id)
    assert ids_in_order[3] == str(older.id)


def test_my_listings_empty_when_caller_owns_nothing(db_session):
    owner = insert_member(db_session, email="owner@example.com")

    response = get_my_listings(owner, db_session)

    assert response == []


def test_my_listings_coerces_null_description_and_category(db_session):
    # The columns allow null, but the response types them as plain strings, so a
    # null comes back as an empty string instead of crashing the response build.
    owner = insert_member(db_session, email="owner@example.com")
    listing = insert_listing(db_session, owner, title="Bare")
    listing.description = None
    listing.category = None
    db_session.commit()

    response = get_my_listings(owner, db_session)

    assert len(response) == 1
    assert response[0].description == ""
    assert response[0].category == ""


# --- deactivated_by signal --------------------------------------------------


def test_my_listings_sets_deactivated_by_for_admin_takedown(db_session):
    # An admin-deactivated row carries the admin id as a string; an
    # owner-deactivated row and an active row both carry None.
    owner = insert_member(db_session, email="owner@example.com")
    admin = insert_member(db_session, role="admin", email="admin@example.com", name="Admin")
    insert_listing(db_session, owner, title="AdminDown", status="deactivated", deactivated_by=admin.id)
    insert_listing(db_session, owner, title="OwnerDown", status="deactivated", deactivated_by=None)
    insert_listing(db_session, owner, title="ActiveOne", status="active")

    response = get_my_listings(owner, db_session)

    admin_down_item = None
    owner_down_item = None
    active_item = None
    for item in response:
        if item.title == "AdminDown":
            admin_down_item = item
        if item.title == "OwnerDown":
            owner_down_item = item
        if item.title == "ActiveOne":
            active_item = item
    assert admin_down_item.deactivated_by == str(admin.id)
    assert owner_down_item.deactivated_by is None
    assert active_item.deactivated_by is None


# --- caller status gate -----------------------------------------------------


def test_my_listings_denies_suspended_caller(db_session):
    caller = insert_member(db_session, status="suspended", email="suspended@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_my_listings(caller, db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail.lower()


def test_my_listings_denies_inactive_caller(db_session):
    caller = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised_error:
        get_my_listings(caller, db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail.lower()


# --- database failure --------------------------------------------------------


def test_my_listings_returns_503_on_listing_load_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Owner",
        email="owner@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        get_my_listings(member, broken_session)

    assert raised_error.value.status_code == 503


# --- route wiring -----------------------------------------------------------


def test_my_listings_route_is_wired_with_get_method():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/my-listings" and "GET" in route.methods:
                found_route = route
    assert found_route is not None
