# Tests for the edit-listing endpoint (US-16).
# Run from the project root with:
# uv run --locked --all-groups --directory backend pytest tests/test_listing_edit.py -v

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.main import app
from app.models.listing import Listing
from app.models.member import Member
from app.routers.listing import edit_listing
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


def make_request(
    title="Fresh Kale",
    description="Crisp greens from the garden.",
    category="Greens",
    total_quantity=8,
    dietary_tags=None,
    allergen_tags=None,
    pickup_start=None,
    pickup_end=None,
):
    if dietary_tags is None:
        dietary_tags = []
    if allergen_tags is None:
        allergen_tags = []
    if pickup_start is None:
        pickup_start = datetime(2026, 7, 2, 9, 0, tzinfo=timezone.utc)
    if pickup_end is None:
        pickup_end = datetime(2026, 7, 2, 11, 0, tzinfo=timezone.utc)
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


def snapshot_listing(session, listing_id):
    session.expire_all()
    row = session.get(Listing, listing_id)
    return {
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


def test_edit_listing_updates_all_fields_and_normalizes_tags(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    pickup_start = datetime(2026, 7, 3, 8, 30, tzinfo=timezone.utc)
    pickup_end = datetime(2026, 7, 3, 10, 30, tzinfo=timezone.utc)
    payload = make_request(
        title="  Fresh Kale  ",
        description="  Washed and bundled.  ",
        category="  Greens  ",
        total_quantity=9,
        dietary_tags=[" Vegan ", "", "Vegan", " Nut Free "],
        allergen_tags=[" Nuts ", "Nuts", "", "Soy"],
        pickup_start=pickup_start,
        pickup_end=pickup_end,
    )

    response = edit_listing(str(listing.id), payload, owner, db_session)

    assert response.id == str(listing.id)
    assert response.owner_id == str(owner.id)
    assert response.title == "Fresh Kale"
    assert response.description == "Washed and bundled."
    assert response.category == "Greens"
    assert response.total_quantity == 9
    assert response.remaining_quantity == 9
    assert response.dietary_tags == ["Vegan", "Nut Free"]
    assert response.allergen_tags == ["Nuts", "Soy"]
    assert response.pickup_start == pickup_start
    assert response.pickup_end == pickup_end
    assert response.status == "active"

    row = db_session.scalars(select(Listing).where(Listing.id == listing.id)).first()
    assert row.title == "Fresh Kale"
    assert row.description == "Washed and bundled."
    assert row.category == "Greens"
    assert row.total_quantity == 9
    assert row.remaining_quantity == 9
    assert row.dietary_tags == ["Vegan", "Nut Free"]
    assert row.allergen_tags == ["Nuts", "Soy"]
    assert row.pickup_window.lower == pickup_start
    assert row.pickup_window.upper == pickup_end


@pytest.mark.parametrize("status", ["deactivated", "claimed"])
def test_edit_listing_refuses_non_active_listing_and_leaves_it_unchanged(db_session, status):
    owner = insert_member(db_session, "active")
    deactivated_by = None
    if status == "deactivated":
        admin = insert_member(db_session, "active", "admin@example.com")
        deactivated_by = admin.id
    listing = insert_listing(db_session, owner, status=status, deactivated_by=deactivated_by)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(), owner, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "This listing is unavailable."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_edit_listing_rejects_a_whitespace_title_and_leaves_the_row_unchanged(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)
    payload = make_request(title="   ")

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), payload, owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "Title must not be blank."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_edit_listing_rejects_a_whitespace_description(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    payload = make_request(description="   ")

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), payload, owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "Description must not be blank."


def test_edit_listing_rejects_a_blank_category(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    payload = make_request(category="")

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), payload, owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "Category must not be blank."


def test_edit_listing_rejects_zero_quantity(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    payload = make_request(total_quantity=0)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), payload, owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "Quantity available must be greater than zero."


def test_edit_listing_rejects_negative_quantity(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    payload = make_request(total_quantity=-3)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), payload, owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "Quantity available must be greater than zero."


def test_edit_listing_rejects_end_not_after_start(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner)
    start = datetime(2026, 7, 2, 9, 0, tzinfo=timezone.utc)
    payload = make_request(pickup_start=start, pickup_end=start)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), payload, owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "The pickup end time must be after the start time."


def test_edit_listing_enforces_quantity_floor_and_shifts_remaining(db_session):
    owner = insert_member(db_session, "active")
    listing = insert_listing(db_session, owner, total_quantity=10, remaining_quantity=3)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(total_quantity=6), owner, db_session)

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == (
        "The quantity available cannot be less than the amount already approved (7)."
    )

    response = edit_listing(str(listing.id), make_request(total_quantity=12), owner, db_session)
    assert response.total_quantity == 12
    assert response.remaining_quantity == 5

    response = edit_listing(str(listing.id), make_request(total_quantity=7), owner, db_session)
    assert response.total_quantity == 7
    assert response.remaining_quantity == 0


def test_edit_listing_denies_a_non_owner_and_leaves_the_row_unchanged(db_session):
    owner = insert_member(db_session, "active", "owner@example.com")
    other_member = insert_member(db_session, "active", "other@example.com")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(), other_member, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "You can only edit your own listing."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_edit_listing_denies_a_suspended_owner_and_leaves_the_row_unchanged(db_session):
    owner = insert_member(db_session, "suspended")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(), owner, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "Your account is suspended, so you cannot edit a listing."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_edit_listing_denies_an_inactive_owner_and_leaves_the_row_unchanged(db_session):
    owner = insert_member(db_session, "inactive")
    listing = insert_listing(db_session, owner)
    before_snapshot = snapshot_listing(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(), owner, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "Your account is not active, so you cannot edit a listing."
    assert_listing_unchanged(db_session, listing.id, before_snapshot)


def test_edit_listing_unknown_id_returns_404(db_session):
    member = insert_member(db_session, "active")

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(uuid.uuid4()), make_request(), member, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "This listing is unavailable."


def test_edit_listing_malformed_id_returns_404(db_session):
    member = insert_member(db_session, "active")

    with pytest.raises(HTTPException) as raised_error:
        edit_listing("not-a-uuid", make_request(), member, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "This listing is unavailable."


def test_edit_listing_returns_503_on_database_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Poster",
        email="poster@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(uuid.uuid4()), make_request(), member, broken_session)

    assert raised_error.value.status_code == 503


class PhotoReadFailsAfterCommitSession:
    # A session stand-in for the edit route: the first read returns the
    # listing, the commit succeeds, and the photos read after the commit
    # raises, which must surface as a 503.
    def __init__(self, listing):
        self.listing = listing
        self.read_count = 0

    def scalars(self, *args, **kwargs):
        self.read_count = self.read_count + 1
        if self.read_count == 1:
            return PhotoReadResultStub([self.listing])
        raise Exception("database is down")

    def commit(self):
        return None

    def rollback(self):
        return None


class PhotoReadResultStub:
    def __init__(self, rows):
        self.rows = rows

    def first(self):
        if self.rows:
            return self.rows[0]
        return None

    def all(self):
        return self.rows


class CommitFailsSession:
    # A session stand-in for the edit route: the read returns the listing and
    # the commit raises, which must roll back and surface as a 503.
    def __init__(self, listing):
        self.listing = listing
        self.rolled_back = False

    def scalars(self, *args, **kwargs):
        return PhotoReadResultStub([self.listing])

    def commit(self):
        raise Exception("database is down")

    def rollback(self):
        self.rolled_back = True


def test_edit_listing_returns_503_and_rolls_back_on_a_commit_error():
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
        title="Fresh Kale",
        description="Crisp greens.",
        category="Greens",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=8,
        remaining_quantity=8,
        status="active",
    )
    session = CommitFailsSession(listing)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(), member, session)

    assert raised_error.value.status_code == 503
    assert session.rolled_back is True


def test_edit_listing_returns_503_when_the_photo_read_fails():
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
        title="Fresh Kale",
        description="Crisp greens.",
        category="Greens",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=8,
        remaining_quantity=8,
        status="active",
    )
    session = PhotoReadFailsAfterCommitSession(listing)

    with pytest.raises(HTTPException) as raised_error:
        edit_listing(str(listing.id), make_request(), member, session)

    assert raised_error.value.status_code == 503


def test_edit_listing_route_is_wired_with_put_method():
    from fastapi.routing import APIRoute

    found_route = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/listings/{listing_id}" and "PUT" in route.methods:
                found_route = route
    assert found_route is not None
