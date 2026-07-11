import base64
import io
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError
from starlette.datastructures import Headers, UploadFile

from app.main import app
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import Member
from app.routers.listing import browse_listings, get_listing, get_my_listings
from app.routers.listing_photo import (
    MAX_PHOTO_BYTES,
    MAX_PHOTOS_PER_LISTING,
    delete_listing_photo,
    serve_listing_photo,
    upload_listing_photo,
)
from app.schemas.listing import ListingPhotoRef

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


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


def insert_listing(session, owner, status="active", title="Fresh Tomatoes"):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description="Ripe red tomatoes from the garden.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status=status,
    )
    session.add(listing)
    session.commit()
    return listing


def insert_photo(session, listing, position=0, content_type="image/png"):
    photo = ListingPhoto(
        listing_id=listing.id,
        content_type=content_type,
        image_bytes=ONE_PIXEL_PNG,
        position=position,
    )
    session.add(photo)
    session.commit()
    return photo


def make_upload(image_bytes, content_type="image/png", filename="test.png"):
    headers = Headers()
    if content_type is not None:
        headers = Headers({"content-type": content_type})
    return UploadFile(
        file=io.BytesIO(image_bytes),
        filename=filename,
        headers=headers,
    )


def count_photos(session, listing_id):
    rows = session.scalars(
        select(ListingPhoto).where(ListingPhoto.listing_id == listing_id)
    ).all()
    return len(rows)


def test_owner_can_upload_photos_and_positions_increase(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)

    first = upload_listing_photo(
        str(listing.id),
        make_upload(ONE_PIXEL_PNG),
        owner,
        db_session,
    )
    second = upload_listing_photo(
        str(listing.id),
        make_upload(ONE_PIXEL_PNG),
        owner,
        db_session,
    )

    assert isinstance(first, ListingPhotoRef)
    assert first.id != ""
    assert first.content_type == "image/png"
    assert first.position == 0
    assert second.position == 1

    rows = db_session.scalars(
        select(ListingPhoto)
        .where(ListingPhoto.listing_id == listing.id)
        .order_by(ListingPhoto.position)
    ).all()
    assert len(rows) == 2
    assert rows[0].image_bytes == ONE_PIXEL_PNG
    assert rows[0].content_type == "image/png"
    assert len(rows[0].image_bytes) == len(ONE_PIXEL_PNG)


def test_new_photo_uses_position_after_the_current_highest(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    first = insert_photo(db_session, listing, 0)
    middle = insert_photo(db_session, listing, 1)
    insert_photo(db_session, listing, 2)

    delete_listing_photo(str(listing.id), str(middle.id), owner, db_session)
    response = upload_listing_photo(
        str(listing.id),
        make_upload(ONE_PIXEL_PNG),
        owner,
        db_session,
    )

    assert response.position == 3
    assert db_session.get(ListingPhoto, first.id) is not None


@pytest.mark.parametrize("content_type", ["text/plain", None])
def test_upload_rejects_an_unallowed_or_missing_type_without_changes(
    db_session,
    content_type,
):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    insert_photo(db_session, listing)
    count_before = count_photos(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG, content_type),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail.startswith("That file type is not allowed.")
    assert count_photos(db_session, listing.id) == count_before


def test_upload_rejects_a_large_file_without_changes(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    insert_photo(db_session, listing)
    count_before = count_photos(db_session, listing.id)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(b"0" * (MAX_PHOTO_BYTES + 1)),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 413
    assert raised_error.value.detail == "That file is too large. The maximum size is 2 MB."
    assert count_photos(db_session, listing.id) == count_before


def test_upload_rejects_an_empty_file_without_changes(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(b""),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "That file is empty."
    assert count_photos(db_session, listing.id) == 0


def test_upload_rejects_the_fourth_photo_without_changes(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    for position in range(MAX_PHOTOS_PER_LISTING):
        insert_photo(db_session, listing, position)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 422
    assert raised_error.value.detail == "This listing already has the most photos allowed (3)."
    assert count_photos(db_session, listing.id) == MAX_PHOTOS_PER_LISTING


def test_non_owner_cannot_upload_and_existing_photos_do_not_change(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    other_member = insert_member(db_session, email="other@example.com")
    listing = insert_listing(db_session, owner)
    insert_photo(db_session, listing)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG),
            other_member,
            db_session,
        )

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "You can only change photos on your own listing."
    assert count_photos(db_session, listing.id) == 1


@pytest.mark.parametrize(
    ("status", "message"),
    [
        ("suspended", "Your account is suspended, so you cannot add a photo."),
        ("inactive", "Your account is not active, so you cannot add a photo."),
    ],
)
def test_non_active_owner_cannot_upload(db_session, status, message):
    owner = insert_member(db_session, status=status)
    listing = insert_listing(db_session, owner)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == message
    assert count_photos(db_session, listing.id) == 0


def test_upload_rejects_a_non_active_listing(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner, status="deactivated")

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 404
    assert count_photos(db_session, listing.id) == 0


@pytest.mark.parametrize("listing_id", ["not-a-uuid", str(uuid.uuid4())])
def test_upload_rejects_an_unknown_or_malformed_listing(db_session, listing_id):
    owner = insert_member(db_session)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            listing_id,
            make_upload(ONE_PIXEL_PNG),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 404


def test_upload_returns_503_on_a_database_read_error(broken_session):
    owner = Member(id=uuid.uuid4(), status="active")

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(uuid.uuid4()),
            make_upload(ONE_PIXEL_PNG),
            owner,
            broken_session,
        )

    assert raised_error.value.status_code == 503


class ResultStub:
    def __init__(self, values):
        self.values = values

    def first(self):
        if not self.values:
            return None
        return self.values[0]

    def all(self):
        return self.values


class CommitFailsSession:
    def __init__(self, result_groups):
        self.result_groups = result_groups
        self.rollback_called = False

    def scalars(self, *args, **kwargs):
        values = self.result_groups.pop(0)
        return ResultStub(values)

    def add(self, *args, **kwargs):
        pass

    def flush(self, *args, **kwargs):
        pass

    def delete(self, *args, **kwargs):
        pass

    def commit(self, *args, **kwargs):
        raise OperationalError("statement", {}, Exception("commit failed"))

    def rollback(self, *args, **kwargs):
        self.rollback_called = True


class SecondReadFailsSession:
    def __init__(self, listing):
        self.listing = listing
        self.read_count = 0

    def scalars(self, *args, **kwargs):
        self.read_count = self.read_count + 1
        if self.read_count == 1:
            return ResultStub([self.listing])
        raise OperationalError("statement", {}, Exception("database is down"))


def test_upload_returns_503_and_rolls_back_on_a_commit_error():
    owner = Member(id=uuid.uuid4(), status="active")
    listing = Listing(id=uuid.uuid4(), owner_id=owner.id, status="active")
    session = CommitFailsSession([[listing], []])

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG),
            owner,
            session,
        )

    assert raised_error.value.status_code == 503
    assert session.rollback_called is True


def test_upload_returns_503_when_loading_existing_photos_fails():
    owner = Member(id=uuid.uuid4(), status="active")
    listing = Listing(id=uuid.uuid4(), owner_id=owner.id, status="active")
    session = SecondReadFailsSession(listing)

    with pytest.raises(HTTPException) as raised_error:
        upload_listing_photo(
            str(listing.id),
            make_upload(ONE_PIXEL_PNG),
            owner,
            session,
        )

    assert raised_error.value.status_code == 503


def test_owner_can_remove_one_photo_without_removing_another(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    removed_photo = insert_photo(db_session, listing, 0)
    kept_photo = insert_photo(db_session, listing, 1)
    removed_photo_id = removed_photo.id
    kept_photo_id = kept_photo.id

    response = delete_listing_photo(
        str(listing.id),
        str(removed_photo_id),
        owner,
        db_session,
    )

    assert response is None
    assert db_session.get(ListingPhoto, removed_photo_id) is None
    assert db_session.get(ListingPhoto, kept_photo_id) is not None


def test_non_owner_cannot_remove_a_photo(db_session):
    owner = insert_member(db_session, email="owner@example.com")
    other_member = insert_member(db_session, email="other@example.com")
    listing = insert_listing(db_session, owner)
    photo = insert_photo(db_session, listing)
    photo_id = photo.id

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(listing.id),
            str(photo_id),
            other_member,
            db_session,
        )

    assert raised_error.value.status_code == 403
    assert db_session.get(ListingPhoto, photo_id) is not None


@pytest.mark.parametrize("status", ["suspended", "inactive"])
def test_non_active_owner_cannot_remove_a_photo(db_session, status):
    owner = insert_member(db_session, status=status)
    listing = insert_listing(db_session, owner)
    photo = insert_photo(db_session, listing)
    photo_id = photo.id

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(listing.id),
            str(photo_id),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 403
    assert db_session.get(ListingPhoto, photo_id) is not None


def test_remove_rejects_a_photo_from_another_listing(db_session):
    owner = insert_member(db_session)
    first_listing = insert_listing(db_session, owner, title="First")
    second_listing = insert_listing(db_session, owner, title="Second")
    first_photo = insert_photo(db_session, first_listing)
    second_photo = insert_photo(db_session, second_listing)

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(first_listing.id),
            str(second_photo.id),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 404
    assert db_session.get(ListingPhoto, first_photo.id) is not None
    assert db_session.get(ListingPhoto, second_photo.id) is not None


def test_remove_rejects_an_unknown_photo(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(listing.id),
            str(uuid.uuid4()),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == "That photo was not found."


@pytest.mark.parametrize(
    ("listing_id", "photo_id", "expected_detail"),
    [
        ("not-a-uuid", str(uuid.uuid4()), "This listing is unavailable."),
        (str(uuid.uuid4()), "not-a-uuid", "That photo was not found."),
    ],
)
def test_remove_rejects_malformed_ids(
    db_session,
    listing_id,
    photo_id,
    expected_detail,
):
    owner = insert_member(db_session)

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(listing_id, photo_id, owner, db_session)

    assert raised_error.value.status_code == 404
    assert raised_error.value.detail == expected_detail


def test_remove_rejects_a_non_active_listing(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner, status="deactivated")
    photo = insert_photo(db_session, listing)

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(listing.id),
            str(photo.id),
            owner,
            db_session,
        )

    assert raised_error.value.status_code == 404
    assert db_session.get(ListingPhoto, photo.id) is not None


def test_remove_returns_503_on_a_database_read_error(broken_session):
    owner = Member(id=uuid.uuid4(), status="active")

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(uuid.uuid4()),
            str(uuid.uuid4()),
            owner,
            broken_session,
        )

    assert raised_error.value.status_code == 503


def test_remove_returns_503_and_rolls_back_on_a_commit_error():
    owner = Member(id=uuid.uuid4(), status="active")
    listing = Listing(id=uuid.uuid4(), owner_id=owner.id, status="active")
    photo = ListingPhoto(id=uuid.uuid4(), listing_id=listing.id, position=0)
    session = CommitFailsSession([[listing], [photo]])

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(listing.id),
            str(photo.id),
            owner,
            session,
        )

    assert raised_error.value.status_code == 503
    assert session.rollback_called is True


def test_remove_returns_503_when_loading_the_photo_fails():
    owner = Member(id=uuid.uuid4(), status="active")
    listing = Listing(id=uuid.uuid4(), owner_id=owner.id, status="active")
    session = SecondReadFailsSession(listing)

    with pytest.raises(HTTPException) as raised_error:
        delete_listing_photo(
            str(listing.id),
            str(uuid.uuid4()),
            owner,
            session,
        )

    assert raised_error.value.status_code == 503


def test_photo_bytes_are_served_with_type_and_cache_header(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    photo = insert_photo(db_session, listing, content_type="image/webp")

    response = serve_listing_photo(str(photo.id), db_session)

    assert response.body == ONE_PIXEL_PNG
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.parametrize("photo_id", ["not-a-uuid", str(uuid.uuid4())])
def test_serve_rejects_an_unknown_or_malformed_photo(db_session, photo_id):
    with pytest.raises(HTTPException) as raised_error:
        serve_listing_photo(photo_id, db_session)

    assert raised_error.value.status_code == 404


def test_serve_returns_503_on_a_database_error(broken_session):
    with pytest.raises(HTTPException) as raised_error:
        serve_listing_photo(str(uuid.uuid4()), broken_session)

    assert raised_error.value.status_code == 503


def test_photos_appear_in_listing_detail_browse_and_owner_responses(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)
    later_photo = insert_photo(db_session, listing, position=2, content_type="image/webp")
    first_photo = insert_photo(db_session, listing, position=0, content_type="image/png")

    detail = get_listing(str(listing.id), owner, db_session)
    browse = browse_listings(current_member=owner, session=db_session)
    mine = get_my_listings(owner, db_session)

    assert [photo.id for photo in detail.photos] == [str(first_photo.id), str(later_photo.id)]
    assert detail.photos[0].content_type == "image/png"
    assert [photo.id for photo in browse[0].photos] == [str(first_photo.id), str(later_photo.id)]
    assert [photo.id for photo in mine[0].photos] == [str(first_photo.id), str(later_photo.id)]


def test_listing_without_photos_returns_an_empty_list(db_session):
    owner = insert_member(db_session)
    listing = insert_listing(db_session, owner)

    response = get_listing(str(listing.id), owner, db_session)

    assert response.photos == []


def test_photo_routes_are_wired_with_expected_methods_and_statuses():
    upload_route = None
    delete_route = None
    serve_route = None
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path == "/api/listings/{listing_id}/photos":
            upload_route = route
        elif route.path == "/api/listings/{listing_id}/photos/{photo_id}":
            delete_route = route
        elif route.path == "/api/photos/{photo_id}":
            serve_route = route

    assert upload_route is not None
    assert upload_route.methods == {"POST"}
    assert upload_route.status_code == 201
    assert delete_route is not None
    assert delete_route.methods == {"DELETE"}
    assert delete_route.status_code == 204
    assert serve_route is not None
    assert serve_route.methods == {"GET"}
