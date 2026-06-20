# Tests for the create-listing endpoint and the shared identity dependency.
# Run from the project root with: npm run test:backend
# Most tests call the route function directly with the shared Postgres session
# from conftest.py and a seeded member to own the listing. A couple use a
# TestClient to exercise the HTTP layer (the header parsing and the 201 status).

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.dependencies import get_current_member
from app.main import app
from app.models.listing import Listing
from app.models.member import Member
from app.routers.listing import create_listing
from app.schemas.listing import CreateListingRequest


def insert_member(session, status="active", email="poster@example.com"):
    member = Member(
        name="Poster",
        email=email,
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def count_listings(session):
    rows = session.scalars(select(Listing)).all()
    return len(rows)


def make_request(
    title="Fresh Tomatoes",
    description="Ripe red tomatoes from the garden.",
    category="Vegetables",
    total_quantity=5,
    dietary_tags=None,
    allergen_tags=None,
    pickup_start=None,
    pickup_end=None,
):
    # None stands in for the list and datetime defaults so the same fresh value
    # is built each call (no shared mutable default).
    if dietary_tags is None:
        dietary_tags = []
    if allergen_tags is None:
        allergen_tags = []
    if pickup_start is None:
        pickup_start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    if pickup_end is None:
        pickup_end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    return CreateListingRequest(
        title=title,
        description=description,
        category=category,
        total_quantity=total_quantity,
        dietary_tags=dietary_tags,
        allergen_tags=allergen_tags,
        pickup_start=pickup_start,
        pickup_end=pickup_end,
    )


# --- happy path (Scenario 1): valid create persists an active listing ---


def test_create_listing_persists_an_active_listing(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(total_quantity=5, dietary_tags=["vegan"], allergen_tags=["nuts"])

    response = create_listing(payload, member, db_session)

    # The response carries the saved values.
    assert response.owner_id == str(member.id)
    assert response.remaining_quantity == 5
    assert response.total_quantity == 5
    assert response.status == "active"
    assert response.dietary_tags == ["vegan"]
    assert response.allergen_tags == ["nuts"]

    # The persisted row matches.
    row = db_session.scalars(select(Listing).where(Listing.id == uuid.UUID(response.id))).first()
    assert row is not None
    assert row.owner_id == member.id
    assert row.remaining_quantity == 5
    assert row.total_quantity == 5
    assert row.status == "active"
    assert row.dietary_tags == ["vegan"]
    assert row.allergen_tags == ["nuts"]
    assert row.deactivated_by is None


# --- range round-trip: the pickup window binds and reads back correctly ---


def test_create_listing_pickup_window_round_trips(db_session):
    member = insert_member(db_session, "active")
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    payload = make_request(pickup_start=start, pickup_end=end)

    response = create_listing(payload, member, db_session)

    row = db_session.scalars(select(Listing).where(Listing.id == uuid.UUID(response.id))).first()
    # The stored range keeps the start (included) and end (excluded). datetime
    # equality compares the instant, so the timezone representation does not
    # have to match exactly.
    assert row.pickup_window.lower == start
    assert row.pickup_window.upper == end
    assert row.pickup_window.bounds == "[)"

    # The response echoes the request times, not values read back off the row.
    assert response.pickup_start == start
    assert response.pickup_end == end


# --- tag normalization ---


def test_create_listing_normalizes_tags(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(
        dietary_tags=["  vegan  ", "vegan", "Vegan", "", "   ", "organic"],
        allergen_tags=["nuts", "nuts"],
    )

    response = create_listing(payload, member, db_session)

    # Trimmed, blanks dropped, exact duplicates collapsed, and case preserved:
    # "Vegan" stays separate from "vegan".
    assert response.dietary_tags == ["vegan", "Vegan", "organic"]
    assert response.allergen_tags == ["nuts"]


def test_create_listing_accepts_empty_tag_lists(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(dietary_tags=[], allergen_tags=[])

    response = create_listing(payload, member, db_session)

    assert response.dietary_tags == []
    assert response.allergen_tags == []


# --- validation (Scenario 2): the route rejects bad details with 422 ---


def test_create_listing_rejects_a_whitespace_title(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(title="   ")

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 422
    assert count_listings(db_session) == 0


def test_create_listing_rejects_a_whitespace_description(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(description="   ")

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 422
    assert count_listings(db_session) == 0


def test_create_listing_rejects_a_blank_category(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(category="")

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 422
    assert count_listings(db_session) == 0


def test_create_listing_rejects_zero_quantity(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(total_quantity=0)

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 422
    assert count_listings(db_session) == 0


def test_create_listing_rejects_negative_quantity(db_session):
    member = insert_member(db_session, "active")
    payload = make_request(total_quantity=-3)

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 422
    assert count_listings(db_session) == 0


def test_create_listing_rejects_end_not_after_start(db_session):
    member = insert_member(db_session, "active")
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    # Equal start and end: the window is empty, so the route rejects it.
    payload = make_request(pickup_start=start, pickup_end=start)

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 422
    assert count_listings(db_session) == 0


def test_schema_rejects_timezone_naive_pickup():
    # A datetime with no timezone is rejected by the schema validator, which
    # FastAPI turns into a 422 before the route runs.
    naive_start = datetime(2026, 7, 1, 9, 0)
    with pytest.raises(ValidationError):
        make_request(pickup_start=naive_start)


# --- permission rule (Scenario 3): non-active members are denied with 403 ---


def test_create_listing_denies_a_suspended_member(db_session):
    member = insert_member(db_session, "suspended")
    payload = make_request()

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 403
    assert "suspended" in raised_error.value.detail
    assert count_listings(db_session) == 0


def test_create_listing_denies_an_inactive_member(db_session):
    member = insert_member(db_session, "inactive")
    payload = make_request()

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, db_session)

    assert raised_error.value.status_code == 403
    assert "not active" in raised_error.value.detail
    assert count_listings(db_session) == 0


# --- Pydantic-level: wrong types for the quantity are rejected ---


def test_schema_rejects_a_non_numeric_quantity():
    # Pydantic lax mode coerces a numeric string like "5", so this asserts the
    # truly wrong types instead.
    with pytest.raises(ValidationError):
        make_request(total_quantity="abc")


def test_schema_rejects_a_list_quantity():
    with pytest.raises(ValidationError):
        make_request(total_quantity=[1, 2])


# --- identity dependency (get_current_member) ---


def test_get_current_member_loads_an_existing_member(db_session):
    member = insert_member(db_session, "active")

    loaded = get_current_member(x_member_id=str(member.id), session=db_session)

    assert loaded.id == member.id


def test_get_current_member_missing_header_returns_401(db_session):
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id=None, session=db_session)
    assert raised_error.value.status_code == 401


def test_get_current_member_blank_header_returns_401(db_session):
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id="   ", session=db_session)
    assert raised_error.value.status_code == 401


def test_get_current_member_non_uuid_header_returns_401(db_session):
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id="not-a-uuid", session=db_session)
    assert raised_error.value.status_code == 401


def test_get_current_member_unknown_member_returns_401(db_session):
    # A well-formed UUID that is not in the database.
    missing_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id=missing_id, session=db_session)
    assert raised_error.value.status_code == 401


def test_get_current_member_returns_503_on_database_error(broken_session):
    # A valid UUID whose lookup hits a database error returns 503, not 500.
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id=str(uuid.uuid4()), session=broken_session)
    assert raised_error.value.status_code == 503


# --- database failure: a commit error returns 503 ---


def test_create_listing_returns_503_on_database_error(broken_session):
    # The member object only needs an id and an active status; it is never read
    # from the database. The broken session raises on flush inside the route, so
    # the route returns 503 instead of an unhandled error.
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    payload = make_request()

    with pytest.raises(HTTPException) as raised_error:
        create_listing(payload, member, broken_session)

    assert raised_error.value.status_code == 503


# --- route wiring and the 201 status code ---


def test_create_listing_route_is_wired_with_201_status():
    from fastapi.routing import APIRoute

    found_status = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/listings" and "POST" in route.methods:
                found_status = route.status_code
    assert found_status == 201
