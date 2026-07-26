# Tests for the admin basic activity report endpoint (US-28).
# Run from the project root with: npm run test:backend
#
# Like test_admin_members.py, the core tests call generate_report() directly.
# The route-layer tests check the passthrough; permission denial for a
# non-admin caller is already covered generically by require_admin's own
# tests in test_admin_members.py, so it is not duplicated here.

from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range

from app.main import app
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.suspension_record import SuspensionRecord
from app.routers.admin_reports import generate_report, generate_report_endpoint


def insert_member(session, name="Alice", email="alice@example.com", status="active", created_at=None):
    member = Member(name=name, email=email, password_hash="not-a-real-hash", status=status)
    session.add(member)
    session.commit()
    if created_at is not None:
        member.created_at = created_at
        session.commit()
    return member


def insert_listing(session, owner, status="active", created_at=None):
    pickup_window = Range(
        datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),
        datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc),
        bounds="[)",
    )
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=pickup_window,
        status=status,
    )
    session.add(listing)
    session.commit()
    if created_at is not None:
        listing.created_at = created_at
        session.commit()
    return listing


def insert_claim(session, listing, claimant, status="requested", requested_at=None, completed_at=None):
    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=1,
        status=status,
        requested_at=requested_at if requested_at is not None else datetime.now(timezone.utc),
        completed_at=completed_at,
    )
    session.add(claim)
    session.commit()
    return claim


def insert_suspension_record(session, member, admin, created_at=None, lifted_at=None):
    record = SuspensionRecord(
        member_id=member.id,
        admin_id=admin.id,
        reason=None,
        created_at=created_at if created_at is not None else datetime.now(timezone.utc),
        lifted_at=lifted_at,
    )
    session.add(record)
    session.commit()
    return record


# --- core: status breakdowns, zero-filled ---


def test_generate_report_with_no_data_zero_fills_every_status(db_session):
    result = generate_report(None, None, db_session)

    assert result.listings_by_status == {
        "active": 0, "claimed": 0, "expired": 0, "cancelled": 0, "deactivated": 0,
    }
    assert result.requests_by_status == {
        "requested": 0, "approved": 0, "picked_up": 0, "completed": 0, "cancelled": 0, "denied": 0,
    }
    assert result.members_by_status == {"active": 0, "suspended": 0, "inactive": 0}
    assert result.total_listings == 0
    assert result.total_requests == 0
    assert result.total_members == 0
    assert result.completed_exchanges == 0
    assert result.members_suspended == 0
    assert result.members_reinstated == 0


def test_generate_report_counts_listings_by_status(db_session):
    owner = insert_member(db_session)
    insert_listing(db_session, owner, status="active")
    insert_listing(db_session, owner, status="active")
    insert_listing(db_session, owner, status="deactivated")

    result = generate_report(None, None, db_session)

    assert result.listings_by_status["active"] == 2
    assert result.listings_by_status["deactivated"] == 1
    assert result.total_listings == 3


def test_generate_report_counts_requests_by_status(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    claimant = insert_member(db_session, email="claimant@example.com")
    listing = insert_listing(db_session, owner)
    insert_claim(db_session, listing, claimant, status="requested")
    insert_claim(db_session, listing, claimant, status="denied")

    result = generate_report(None, None, db_session)

    assert result.requests_by_status["requested"] == 1
    assert result.requests_by_status["denied"] == 1
    assert result.total_requests == 2


def test_generate_report_counts_members_by_status(db_session):
    insert_member(db_session, email="a@example.com", status="active")
    insert_member(db_session, email="b@example.com", status="suspended")

    result = generate_report(None, None, db_session)

    assert result.members_by_status["active"] == 1
    assert result.members_by_status["suspended"] == 1
    assert result.total_members == 2


# --- core: completed exchanges counted by completed_at, not requested_at ---


def test_generate_report_completed_exchanges_counts_by_completion_date(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    claimant = insert_member(db_session, email="claimant@example.com")
    listing = insert_listing(db_session, owner)

    # Requested well before the range, but completed inside it: this is an
    # exchange that happened during the reporting window and must count,
    # even though its request did not.
    insert_claim(
        db_session, listing, claimant, status="completed",
        requested_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        completed_at=datetime(2026, 6, 15, tzinfo=timezone.utc),
    )
    # Requested inside the range but never completed: must not count as a
    # completed exchange, even though it does count as a request.
    insert_claim(
        db_session, listing, claimant, status="requested",
        requested_at=datetime(2026, 6, 10, tzinfo=timezone.utc),
    )

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.completed_exchanges == 1
    assert result.requests_by_status["requested"] == 1
    assert result.requests_by_status["completed"] == 0


# --- core: suspension activity from suspension_record (US-25/US-26) ---


def test_generate_report_counts_members_suspended_in_range(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com")
    member = insert_member(db_session, email="bob@example.com")
    insert_suspension_record(db_session, member, admin, created_at=datetime(2026, 6, 15, tzinfo=timezone.utc))

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.members_suspended == 1


def test_generate_report_excludes_suspensions_outside_the_range(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com")
    member = insert_member(db_session, email="bob@example.com")
    insert_suspension_record(db_session, member, admin, created_at=datetime(2026, 5, 1, tzinfo=timezone.utc))

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.members_suspended == 0


def test_generate_report_counts_members_reinstated_in_range(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com")
    member = insert_member(db_session, email="bob@example.com")
    # Suspended before the range, reinstated inside it: this is reinstatement
    # activity that happened during the window, even though the suspension
    # itself did not.
    insert_suspension_record(
        db_session, member, admin,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        lifted_at=datetime(2026, 6, 15, tzinfo=timezone.utc),
    )

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.members_suspended == 0
    assert result.members_reinstated == 1


def test_generate_report_open_suspension_does_not_count_as_reinstated(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com")
    member = insert_member(db_session, email="bob@example.com")
    insert_suspension_record(db_session, member, admin, created_at=datetime(2026, 6, 15, tzinfo=timezone.utc))

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.members_suspended == 1
    assert result.members_reinstated == 0


# --- core: date range filters by each metric's own created_at ---


def test_generate_report_date_range_filters_listings(db_session):
    owner = insert_member(db_session)
    insert_listing(db_session, owner, created_at=datetime(2026, 5, 15, tzinfo=timezone.utc))
    insert_listing(db_session, owner, created_at=datetime(2026, 6, 15, tzinfo=timezone.utc))
    insert_listing(db_session, owner, created_at=datetime(2026, 7, 15, tzinfo=timezone.utc))

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.total_listings == 1


def test_generate_report_date_range_is_inclusive_of_both_endpoints(db_session):
    owner = insert_member(db_session)
    insert_listing(db_session, owner, created_at=datetime(2026, 6, 1, 0, 0, 1, tzinfo=timezone.utc))
    insert_listing(db_session, owner, created_at=datetime(2026, 6, 30, 23, 59, 0, tzinfo=timezone.utc))

    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.total_listings == 2


def test_generate_report_only_start_date_covers_everything_after_it(db_session):
    owner = insert_member(db_session)
    insert_listing(db_session, owner, created_at=datetime(2026, 5, 1, tzinfo=timezone.utc))
    insert_listing(db_session, owner, created_at=datetime(2026, 7, 1, tzinfo=timezone.utc))

    result = generate_report(date(2026, 6, 1), None, db_session)

    assert result.total_listings == 1


def test_generate_report_only_end_date_covers_everything_before_it(db_session):
    owner = insert_member(db_session)
    insert_listing(db_session, owner, created_at=datetime(2026, 5, 1, tzinfo=timezone.utc))
    insert_listing(db_session, owner, created_at=datetime(2026, 7, 1, tzinfo=timezone.utc))

    result = generate_report(None, date(2026, 6, 1), db_session)

    assert result.total_listings == 1


def test_generate_report_echoes_the_requested_date_range(db_session):
    result = generate_report(date(2026, 6, 1), date(2026, 6, 30), db_session)

    assert result.start_date == "2026-06-01"
    assert result.end_date == "2026-06-30"


def test_generate_report_start_after_end_returns_422(db_session):
    with pytest.raises(HTTPException) as raised_error:
        generate_report(date(2026, 7, 1), date(2026, 6, 1), db_session)

    assert raised_error.value.status_code == 422


def test_generate_report_database_error_returns_503(broken_session):
    with pytest.raises(HTTPException) as raised_error:
        generate_report(None, None, broken_session)

    assert raised_error.value.status_code == 503


# --- route wiring ---


def test_generate_report_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/admin/reports" and "GET" in route.methods:
                found = True
    assert found


# --- route passthrough ---


def test_generate_report_endpoint_delegates_to_core(db_session):
    admin = insert_member(db_session, name="Admin Alice", email="admin@example.com")
    insert_listing(db_session, admin, status="active")

    result = generate_report_endpoint(start_date=None, end_date=None, current_member=admin, session=db_session)

    assert result.total_listings == 1
