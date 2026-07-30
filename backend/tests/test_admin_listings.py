# Tests for admin listing management (UC-24).

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.dependencies import require_admin
from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.admin_listings import (
    deactivate_listing_as_admin,
    list_admin_listings,
    reactivate_listing_as_admin,
)
from app.routers.listing import browse_listings


def insert_member(session, *, name, email, role="member"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status="active",
        role=role,
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner, *, status="active", deactivated_by=None, deactivated_at=None):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes from the garden.",
        category="Vegetables",
        dietary_tags=["vegan"],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status=status,
        deactivated_by=deactivated_by,
        deactivated_at=deactivated_at,
    )
    session.add(listing)
    session.commit()
    return listing


def insert_claim(session, listing, claimant, *, status="requested"):
    now = datetime.now(timezone.utc)
    approved_quantity = None
    approved_at = None
    if status == "approved":
        approved_quantity = 1
        approved_at = now
    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=1,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=now,
        approved_at=approved_at,
    )
    session.add(claim)
    session.commit()
    return claim


def snapshot_listing(session, listing_id):
    session.expire_all()
    row = session.get(Listing, listing_id)
    return {
        "owner_id": row.owner_id,
        "title": row.title,
        "description": row.description,
        "category": row.category,
        "dietary_tags": list(row.dietary_tags),
        "allergen_tags": list(row.allergen_tags),
        "total_quantity": row.total_quantity,
        "remaining_quantity": row.remaining_quantity,
        "pickup_start": row.pickup_window.lower,
        "pickup_end": row.pickup_window.upper,
        "pickup_bounds": row.pickup_window.bounds,
        "status": row.status,
        "deactivated_by": row.deactivated_by,
        "deactivated_at": row.deactivated_at,
    }


def test_admin_deactivates_any_active_listing_and_preserves_the_record(db_session):
    admin = insert_member(
        db_session,
        name="Alice Admin",
        email="admin@example.com",
        role="admin",
    )
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    listing = insert_listing(db_session, owner)
    before = snapshot_listing(db_session, listing.id)

    response = deactivate_listing_as_admin(admin, listing.id, db_session)

    assert response is None
    after = snapshot_listing(db_session, listing.id)
    assert after["deactivated_at"] is not None
    expected = dict(before)
    expected["status"] = "deactivated"
    expected["deactivated_by"] = admin.id
    expected["deactivated_at"] = after["deactivated_at"]
    assert after == expected


def test_admin_deactivation_writes_an_audit_log_entry(db_session):
    admin = insert_member(
        db_session, name="Alice Admin", email="admin@example.com", role="admin",
    )
    owner = insert_member(db_session, name="Olivia Owner", email="owner@example.com")
    listing = insert_listing(db_session, owner)

    deactivate_listing_as_admin(admin, listing.id, db_session)

    entry = db_session.scalars(
        select(AdminAuditLog).where(AdminAuditLog.target_id == listing.id)
    ).first()
    assert entry is not None
    assert entry.admin_id == admin.id
    assert entry.action == "listing_deactivated"
    assert entry.target_type == "listing"
    assert entry.reason is None


def test_admin_reactivates_an_owner_deactivated_listing(db_session):
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    listing = insert_listing(
        db_session,
        owner,
        status="deactivated",
        deactivated_by=None,
    )
    before = snapshot_listing(db_session, listing.id)

    response = reactivate_listing_as_admin(listing.id, db_session)

    assert response is None
    after = snapshot_listing(db_session, listing.id)
    expected = dict(before)
    expected["status"] = "active"
    expected["deactivated_by"] = None
    assert after == expected


def test_admin_listing_inventory_includes_active_and_deactivated_rows(db_session):
    admin = insert_member(
        db_session,
        name="Alice Admin",
        email="admin@example.com",
        role="admin",
    )
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    active = insert_listing(db_session, owner, status="active")
    deactivated = insert_listing(
        db_session,
        owner,
        status="deactivated",
        deactivated_by=admin.id,
    )

    rows = list_admin_listings(db_session)

    assert {row.id for row in rows} == {str(active.id), str(deactivated.id)}
    by_id = {row.id: row for row in rows}
    assert by_id[str(active.id)].status == "active"
    assert by_id[str(deactivated.id)].status == "deactivated"
    assert by_id[str(deactivated.id)].deactivated_by == str(admin.id)
    assert by_id[str(active.id)].owner_name == "Olivia Owner"


def test_admin_deactivation_cancels_pending_claims_but_not_approved_claims(db_session):
    admin = insert_member(
        db_session,
        name="Alice Admin",
        email="admin@example.com",
        role="admin",
    )
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    pending_member = insert_member(
        db_session,
        name="Pending Pat",
        email="pending@example.com",
    )
    approved_member = insert_member(
        db_session,
        name="Approved Avery",
        email="approved@example.com",
    )
    listing = insert_listing(db_session, owner)
    pending = insert_claim(db_session, listing, pending_member)
    approved = insert_claim(db_session, listing, approved_member, status="approved")

    deactivate_listing_as_admin(admin, listing.id, db_session)

    db_session.expire_all()
    saved_pending = db_session.scalars(
        select(Claim).where(Claim.id == pending.id)
    ).first()
    saved_approved = db_session.scalars(
        select(Claim).where(Claim.id == approved.id)
    ).first()
    assert saved_pending.status == "cancelled"
    assert saved_pending.cancelled_at is not None
    assert saved_approved.status == "approved"
    assert saved_approved.cancelled_at is None


def test_admin_reactivates_an_admin_deactivated_listing_and_clears_marker(db_session):
    admin = insert_member(
        db_session,
        name="Alice Admin",
        email="admin@example.com",
        role="admin",
    )
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    listing = insert_listing(
        db_session,
        owner,
        status="deactivated",
        deactivated_by=admin.id,
        deactivated_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )

    reactivate_listing_as_admin(listing.id, db_session)

    saved = snapshot_listing(db_session, listing.id)
    assert saved["status"] == "active"
    assert saved["deactivated_by"] is None
    assert saved["deactivated_at"] is None


def test_admin_reactivation_makes_listing_visible_in_browsing(db_session):
    admin = insert_member(
        db_session,
        name="Alice Admin",
        email="admin@example.com",
        role="admin",
    )
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    listing = insert_listing(
        db_session,
        owner,
        status="deactivated",
        deactivated_by=admin.id,
    )

    reactivate_listing_as_admin(listing.id, db_session)
    browse_results = browse_listings(
        q=None,
        category=None,
        dietary_tags=None,
        allergen_tags=None,
        limit=50,
        current_member=admin,
        session=db_session,
    )

    assert str(listing.id) in {row.id for row in browse_results}


def test_admin_reactivation_rejects_an_active_listing_without_changes(db_session):
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    listing = insert_listing(db_session, owner, status="active")
    before = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        reactivate_listing_as_admin(listing.id, db_session)

    assert raised_error.value.status_code == 409
    assert raised_error.value.detail == "Listing is already active."
    assert snapshot_listing(db_session, listing.id) == before


def test_admin_deactivation_rejects_a_non_active_listing_without_changes(db_session):
    admin = insert_member(
        db_session,
        name="Alice Admin",
        email="admin@example.com",
        role="admin",
    )
    owner = insert_member(
        db_session,
        name="Olivia Owner",
        email="owner@example.com",
    )
    listing = insert_listing(db_session, owner, status="deactivated")
    before = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing_as_admin(admin, listing.id, db_session)

    assert raised_error.value.status_code == 409
    assert snapshot_listing(db_session, listing.id) == before


def test_admin_listing_routes_are_wired_and_require_admin():
    expected_routes = {
        ("/api/admin/listings", "GET"),
        ("/api/admin/listings/{listing_id}/deactivate", "POST"),
        ("/api/admin/listings/{listing_id}/reactivate", "POST"),
    }
    found_routes = set()

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for expected_path, expected_method in expected_routes:
            if route.path == expected_path and expected_method in route.methods:
                assert any(
                    dependency.call is require_admin
                    for dependency in route.dependant.dependencies
                )
                found_routes.add((expected_path, expected_method))

    assert found_routes == expected_routes
