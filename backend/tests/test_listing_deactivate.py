# Tests for the deactivate-listing endpoint (US-17).
# Run from the project root with:
# uv run --locked --all-groups --directory backend pytest tests/test_listing_deactivate.py -v

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError

from app.main import app
from app.models.listing import Listing
from app.models.member import Member
from app.routers.listing import deactivate_listing


# These helpers are copied from test_listing_edit.py on purpose. The project
# convention is that each test file defines its own; they are not shared through
# conftest.py.
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


def insert_listing(
    session,
    owner,
    status="active",
    total_quantity=5,
    remaining_quantity=5,
    title="Fresh Tomatoes",
    description="Ripe red tomatoes from the garden.",
    category="Vegetables",
    dietary_tags=None,
    allergen_tags=None,
    deactivated_by=None,
):
    if dietary_tags is None:
        dietary_tags = []
    if allergen_tags is None:
        allergen_tags = []
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description=description,
        category=category,
        dietary_tags=dietary_tags,
        allergen_tags=allergen_tags,
        total_quantity=total_quantity,
        remaining_quantity=remaining_quantity,
        pickup_window=Range(start, end, bounds="[)"),
        status=status,
        deactivated_by=deactivated_by,
    )
    session.add(listing)
    session.commit()
    return listing


def snapshot_listing(session, listing_id):
    # The edit version omits owner_id; this story needs it in the snapshot so the
    # whole-snapshot compare can prove the owner is unchanged after deactivation.
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
    }


def assert_listing_unchanged(session, listing_id, before_snapshot):
    after_snapshot = snapshot_listing(session, listing_id)
    assert after_snapshot == before_snapshot


def test_deactivate_listing_marks_it_deactivated_and_changes_nothing_else(db_session):
    # Scenario 1: the owner deactivates their own active listing.
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    response = deactivate_listing(str(listing.id), owner, db_session)

    # The handler returns None; FastAPI turns that into a 204.
    assert response is None

    after_snapshot = snapshot_listing(db_session, listing.id)
    # Only status changes. Build the expected snapshot from the before-snapshot
    # with status flipped, so every other field (title, quantities, tags, pickup
    # window, owner, and deactivated_by) is proven identical.
    expected_snapshot = dict(before_snapshot)
    expected_snapshot["status"] = "deactivated"
    assert after_snapshot == expected_snapshot
    # deactivated_by stays null: that column is the admin-only signal (US-27).
    assert after_snapshot["deactivated_by"] is None


def test_deactivate_listing_denies_a_non_owner_and_leaves_the_row_unchanged(db_session):
    # Scenario 2: a member who does not own the listing is denied, and the
    # listing stays active.
    owner = insert_member(db_session, "active", "owner@example.com")
    other_member = insert_member(db_session, "active", "other@example.com")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(listing.id), other_member, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "You can only deactivate your own listing."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


@pytest.mark.parametrize("status", ["claimed", "expired", "cancelled", "deactivated"])
def test_deactivate_listing_refuses_a_non_active_listing(db_session, status):
    # Every non-active status reads as unavailable, so an already-inactive
    # listing cannot be deactivated again, and the row is untouched.
    owner = insert_member(db_session, "active")
    deactivated_by = None
    if status == "deactivated":
        # A deactivated row in the wild already records an admin in deactivated_by.
        admin = insert_member(db_session, "active", "admin@example.com")
        deactivated_by = admin.id
    listing = insert_listing(db_session, owner, status=status, deactivated_by=deactivated_by)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(listing.id), owner, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "This listing is unavailable."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_deactivate_listing_denies_a_suspended_owner_and_leaves_the_row_unchanged(db_session):
    # The active-member gate runs before the ownership check, so even the owner
    # is blocked while suspended.
    owner = insert_member(db_session, "suspended")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(listing.id), owner, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "Your account is suspended, so you cannot deactivate a listing."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_deactivate_listing_denies_an_inactive_owner_and_leaves_the_row_unchanged(db_session):
    owner = insert_member(db_session, "inactive")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(listing.id), owner, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "Your account is not active, so you cannot deactivate a listing."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_deactivate_listing_unknown_id_returns_404(db_session):
    member = insert_member(db_session, "active")

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(uuid.uuid4()), member, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "This listing is unavailable."


def test_deactivate_listing_malformed_id_returns_404(db_session):
    member = insert_member(db_session, "active")

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing("not-a-uuid", member, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "This listing is unavailable."


def test_deactivate_listing_returns_503_on_read_database_error(broken_session):
    # broken_session.scalars raises, so this exercises the read try/except.
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(uuid.uuid4()), member, broken_session)

    assert raised_error.value.status_code == 503


# A tiny stand-in session whose read succeeds but whose commit fails, so the
# test reaches the commit try/except that the read-failure test never gets to.
# The read returns a real, active Listing owned by the acting member, so the
# handler passes the ownership and status gates and then tries to commit.
class ScalarsResultStub:
    def __init__(self, listing):
        self.listing = listing

    def first(self):
        return self.listing


class CommitFailsSession:
    def __init__(self, listing):
        self.listing = listing
        self.rollback_called = False

    def scalars(self, *args, **kwargs):
        return ScalarsResultStub(self.listing)

    def commit(self, *args, **kwargs):
        raise OperationalError("statement", {}, Exception("commit failed"))

    def rollback(self, *args, **kwargs):
        self.rollback_called = True

    def close(self, *args, **kwargs):
        pass


def test_deactivate_listing_returns_503_on_commit_database_error():
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    # Built in the test, not added to any session. Only id, owner_id, and status
    # are read before the commit, so those are the fields that matter here.
    listing = Listing(
        id=uuid.uuid4(),
        owner_id=member.id,
        status="active",
    )
    session = CommitFailsSession(listing)

    with pytest.raises(HTTPException) as raised_error:
        deactivate_listing(str(listing.id), member, session)

    assert raised_error.value.status_code == 503
    assert session.rollback_called is True


def test_deactivate_listing_route_is_wired_with_post_method_and_204():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/listings/{listing_id}/deactivate" and "POST" in route.methods:
                found_route = route
    assert found_route is not None
    # Direct-call tests return None and cannot see FastAPI's response status, so
    # this is the only check that the 204 decorator is in place.
    assert found_route.status_code == 204
