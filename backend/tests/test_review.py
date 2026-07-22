# Tests for the review endpoints (US-20): leave, read, and edit a rating and
# review for a completed exchange.
# Run from the project root with: npm run test:backend
#
# The core tests call get_review_context(), create_review(), and edit_review()
# directly with real DB sessions, covering logic without the HTTP layer.
# Route-layer tests call the endpoint functions directly with injected deps.

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import IntegrityError, OperationalError

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.review import Review
from app.routers.review import (
    DISABLED_REVIEW_DELETE_MESSAGE,
    DISABLED_REVIEW_MESSAGE,
    create_review,
    create_review_endpoint,
    delete_review,
    delete_review_endpoint,
    edit_review,
    edit_review_endpoint,
    get_review_context,
    get_review_context_endpoint,
)
from app.schemas.review import CreateReviewPayload, EditReviewPayload


# ── helpers ──────────────────────────────────────────────────────────────────


def insert_member(session, status="active", email="member@example.com", name="Member"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status="active",
    )
    session.add(listing)
    session.commit()
    return listing


def insert_claim(session, listing_id, claimant, quantity=2, status="completed"):
    # A completed claim gets its completed_at set, the way the real
    # complete-exchange endpoint sets it.
    completed_at = None
    if status == "completed":
        completed_at = datetime.now(timezone.utc)
    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=quantity,
        status=status,
        requested_at=datetime.now(timezone.utc),
        completed_at=completed_at,
    )
    session.add(claim)
    session.commit()
    return claim.id


def insert_review(
    session,
    claim_id,
    reviewer,
    reviewee,
    reviewee_role,
    rating=3,
    body="ok",
    disabled_at=None,
    disabled_by=None,
):
    # The two disabled arguments let a test seed an administratively disabled
    # review directly, standing in for the future admin action.
    now = datetime.now(timezone.utc)
    review = Review(
        claim_id=claim_id,
        reviewer_id=reviewer.id,
        reviewee_id=reviewee.id,
        reviewee_role=reviewee_role,
        rating=rating,
        body=body,
        created_at=now,
        updated_at=now,
        disabled_at=disabled_at,
        disabled_by=disabled_by,
    )
    session.add(review)
    session.commit()
    return review.id


def count_reviews(session):
    rows = session.scalars(select(Review)).all()
    return len(rows)


class DiesMidRequestSession:
    # A session that works like the real one for the first few database reads
    # and then fails, simulating a database that dies partway through a
    # request. BrokenSession (conftest) fails on the FIRST call, so it can
    # only reach the first try/except; this one reaches the deeper ones.
    # add/rollback/close are forwarded so the route's cleanup still runs.
    def __init__(self, real_session, allowed_reads, fail_commit=False, flush_error=None):
        self.real_session = real_session
        self.remaining_reads = allowed_reads
        self.fail_commit = fail_commit
        self.flush_error = flush_error

    def scalars(self, *args, **kwargs):
        if self.remaining_reads <= 0:
            raise OperationalError("statement", {}, Exception("database died"))
        self.remaining_reads = self.remaining_reads - 1
        return self.real_session.scalars(*args, **kwargs)

    def add(self, *args, **kwargs):
        self.real_session.add(*args, **kwargs)

    def delete(self, *args, **kwargs):
        self.real_session.delete(*args, **kwargs)

    def flush(self, *args, **kwargs):
        if self.flush_error is not None:
            raise self.flush_error
        self.real_session.flush(*args, **kwargs)

    def commit(self, *args, **kwargs):
        if self.fail_commit:
            raise OperationalError("statement", {}, Exception("database died"))
        self.real_session.commit(*args, **kwargs)

    def rollback(self, *args, **kwargs):
        self.real_session.rollback(*args, **kwargs)

    def close(self, *args, **kwargs):
        self.real_session.close(*args, **kwargs)


def make_completed_exchange(session):
    """An owner, a requestor, a listing, and a completed claim between them."""
    owner = insert_member(session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(session, owner)
    claim_id = insert_claim(session, listing.id, requestor, status="completed")
    return owner, requestor, listing, claim_id


def make_review_payload(rating=4, body="Great to work with."):
    return CreateReviewPayload(rating=rating, body=body)


def make_edit_payload(rating=5, body="Even better than I thought."):
    return EditReviewPayload(rating=rating, body=body)


# ── POST: Scenario 1, the happy paths ─────────────────────────────────────────


def test_owner_reviews_requestor(db_session):
    """The listing owner reviews the other party AS a requestor."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    response = create_review(claim_id, make_review_payload(), owner, db_session)

    assert response.reviewer_id == str(owner.id)
    assert response.reviewee_id == str(requestor.id)
    assert response.reviewee_role == "requestor"
    assert response.rating == 4
    assert response.body == "Great to work with."
    assert response.is_disabled is False

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row is not None
    assert row.claim_id == claim_id
    assert row.reviewer_id == owner.id
    assert row.reviewee_id == requestor.id
    assert row.reviewee_role == "requestor"
    assert row.rating == 4
    assert row.body == "Great to work with."
    assert row.disabled_at is None
    assert row.disabled_by is None


def test_requestor_reviews_owner(db_session):
    """The requestor reviews the other party AS a listing owner."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    response = create_review(claim_id, make_review_payload(rating=5), requestor, db_session)

    assert response.reviewer_id == str(requestor.id)
    assert response.reviewee_id == str(owner.id)
    assert response.reviewee_role == "listing_owner"

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.reviewee_id == owner.id
    assert row.reviewee_role == "listing_owner"


def test_both_participants_review_the_same_exchange(db_session):
    """Two rows with swapped reviewer/reviewee and OPPOSITE roles, no error.

    This is the core proof that the two reputations are recorded separately.
    """
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    create_review(claim_id, make_review_payload(rating=4), owner, db_session)
    create_review(claim_id, make_review_payload(rating=5), requestor, db_session)

    rows = db_session.scalars(
        select(Review).where(Review.claim_id == claim_id).order_by(Review.created_at)
    ).all()
    assert len(rows) == 2

    by_reviewer = {}
    for row in rows:
        by_reviewer[row.reviewer_id] = row
    owner_review = by_reviewer[owner.id]
    requestor_review = by_reviewer[requestor.id]
    assert owner_review.reviewee_id == requestor.id
    assert owner_review.reviewee_role == "requestor"
    assert requestor_review.reviewee_id == owner.id
    assert requestor_review.reviewee_role == "listing_owner"


def test_rating_only_review_stores_empty_body(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    response = create_review(
        claim_id, CreateReviewPayload(rating=3), owner, db_session
    )

    assert response.body == ""
    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.body == ""


def test_spaces_only_body_is_stored_empty(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    response = create_review(
        claim_id, CreateReviewPayload(rating=3, body="   "), owner, db_session
    )

    assert response.body == ""
    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.body == ""


# ── POST: Scenario 2, the exchange is not completed ───────────────────────────


def test_create_review_rejects_every_non_completed_status(db_session):
    """requested, approved, picked_up, denied, and cancelled all get 409."""
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")

    statuses = ["requested", "approved", "picked_up", "denied", "cancelled"]
    for claim_status in statuses:
        listing = insert_listing(db_session, owner)
        claim_id = insert_claim(db_session, listing.id, requestor, status=claim_status)

        with pytest.raises(HTTPException) as raised:
            create_review(claim_id, make_review_payload(), requestor, db_session)
        assert raised.value.status_code == 409, claim_status
        assert "completed" in raised.value.detail

    assert count_reviews(db_session) == 0


# ── POST: Scenario 3, duplicates, and Rule 3, the disabled block ──────────────


def test_duplicate_review_rejected_with_409(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(rating=1), owner, db_session)

    assert raised.value.status_code == 409
    assert raised.value.detail == "You have already reviewed this exchange."
    assert count_reviews(db_session) == 1


def test_disabled_review_blocks_a_replacement_with_403(db_session):
    """THE LOAD-BEARING RULE 3 TEST: a disabled review keeps the member's slot.

    It fails if the duplicate check filters out disabled reviews, and it fails
    if the disabled case returns the generic duplicate message instead of the
    admin message.
    """
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    admin = insert_member(db_session, email="admin@example.com", name="Alice Admin")
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        disabled_at=datetime.now(timezone.utc),
        disabled_by=admin.id,
    )

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(rating=5), owner, db_session)

    assert raised.value.status_code == 403
    assert raised.value.detail == DISABLED_REVIEW_MESSAGE
    assert "administrator" in raised.value.detail
    assert "disabled" in raised.value.detail
    assert count_reviews(db_session) == 1


# ── POST: Scenario 4, a non-participant ───────────────────────────────────────


def test_non_participant_cannot_review(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    outsider = insert_member(db_session, email="outsider@example.com", name="Oscar Outsider")

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), outsider, db_session)

    assert raised.value.status_code == 403
    assert raised.value.detail == "You can only review an exchange you took part in."
    assert count_reviews(db_session) == 0


def test_non_participant_on_a_non_completed_claim_gets_403_not_409(db_session):
    """The participant check runs FIRST, so a stranger cannot probe a claim's
    status from the status code they get back."""
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    outsider = insert_member(db_session, email="outsider@example.com", name="Oscar Outsider")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="requested")

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), outsider, db_session)

    assert raised.value.status_code == 403
    assert count_reviews(db_session) == 0


# ── POST: request schema bounds ───────────────────────────────────────────────


def test_create_payload_rejects_rating_out_of_bounds():
    with pytest.raises(ValidationError):
        CreateReviewPayload(rating=0)
    with pytest.raises(ValidationError):
        CreateReviewPayload(rating=6)


def test_create_payload_accepts_boundary_ratings():
    low = CreateReviewPayload(rating=1)
    high = CreateReviewPayload(rating=5)
    assert low.rating == 1
    assert high.rating == 5


def test_create_payload_body_length_bounds():
    with pytest.raises(ValidationError):
        CreateReviewPayload(rating=3, body="x" * 1001)
    at_limit = CreateReviewPayload(rating=3, body="x" * 1000)
    assert len(at_limit.body) == 1000
    empty = CreateReviewPayload(rating=3)
    assert empty.body == ""


# ── POST: claim guards ────────────────────────────────────────────────────────


def test_create_review_unknown_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        create_review(uuid.uuid4(), make_review_payload(), member, db_session)

    assert raised.value.status_code == 404
    assert raised.value.detail == "Exchange not found."


def test_create_review_non_uuid_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        create_review_endpoint("not-a-uuid", make_review_payload(), member, db_session)

    assert raised.value.status_code == 404
    assert raised.value.detail == "Exchange not found."


# ── POST: reviewee_role integrity ─────────────────────────────────────────────


def test_reviewee_role_comes_from_the_exchange_not_the_request(db_session):
    """For an owner reviewing, the reviewee is the claimant with role
    "requestor"; for a requestor reviewing, the reviewee is the listing owner
    with role "listing_owner"."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    owner_side = create_review(claim_id, make_review_payload(), owner, db_session)
    assert owner_side.reviewee_role == "requestor"
    assert owner_side.reviewee_id == str(requestor.id)

    requestor_side = create_review(claim_id, make_review_payload(), requestor, db_session)
    assert requestor_side.reviewee_role == "listing_owner"
    assert requestor_side.reviewee_id == str(owner.id)


def test_database_rejects_a_bad_reviewee_role(db_session):
    """The ck_review_reviewee_role check fires on a raw insert."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    with pytest.raises(IntegrityError):
        insert_review(db_session, claim_id, owner, requestor, "banana")
    db_session.rollback()


# ── POST: member status and database failure ──────────────────────────────────


def test_suspended_member_cannot_create_review(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    suspended = insert_member(db_session, status="suspended", email="sus@example.com")

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), suspended, db_session)

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail
    assert count_reviews(db_session) == 0


def test_inactive_member_cannot_create_review(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    inactive = insert_member(db_session, status="inactive", email="inactive@example.com")

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), inactive, db_session)

    assert raised.value.status_code == 403
    assert "not active" in raised.value.detail


def test_create_review_database_failure_is_503(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Member",
        email="member@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        create_review(uuid.uuid4(), make_review_payload(), member, broken_session)

    assert raised.value.status_code == 503


def test_create_review_route_is_wired_with_201_status():
    from fastapi.routing import APIRoute

    from app.main import app

    found_status = None
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/claims/{claim_id}/reviews":
                if "POST" in route.methods:
                    found_status = route.status_code
    assert found_status == 201


# ── GET: the review context ───────────────────────────────────────────────────


def test_context_for_the_requestor_side(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    context = get_review_context(claim_id, requestor, db_session)

    assert context.claim_id == str(claim_id)
    assert context.listing_id == str(listing.id)
    assert context.listing_title == "Fresh Tomatoes"
    assert context.role == "requestor"
    assert context.other_party_id == str(owner.id)
    assert context.other_party_name == "Owen Owner"
    assert context.already_reviewed is False
    assert context.existing_review is None
    assert context.can_edit is False


def test_context_for_the_owner_side(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    context = get_review_context(claim_id, owner, db_session)

    assert context.role == "listing_owner"
    assert context.other_party_id == str(requestor.id)
    assert context.other_party_name == "Rita Requestor"


def test_context_after_reviewing_shows_the_existing_review(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)

    context = get_review_context(claim_id, owner, db_session)

    assert context.already_reviewed is True
    assert context.existing_review is not None
    assert context.existing_review.rating == 4
    assert context.existing_review.is_disabled is False
    assert context.can_edit is True
    # The reviewee's role is the OTHER role from the acting member's own.
    assert context.role == "listing_owner"
    assert context.existing_review.reviewee_role == "requestor"


def test_context_shows_the_opposite_role_for_the_requestor_reviewer(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), requestor, db_session)

    context = get_review_context(claim_id, requestor, db_session)

    assert context.role == "requestor"
    assert context.existing_review.reviewee_role == "listing_owner"


def test_context_with_a_disabled_review_freezes_the_screen(db_session):
    """The read side of Rule 3: the screen must be told the review is frozen."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        disabled_at=datetime.now(timezone.utc),
    )

    context = get_review_context(claim_id, owner, db_session)

    assert context.already_reviewed is True
    assert context.existing_review.is_disabled is True
    assert context.can_edit is False


def test_context_non_participant_is_403(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    outsider = insert_member(db_session, email="outsider@example.com", name="Oscar Outsider")

    with pytest.raises(HTTPException) as raised:
        get_review_context(claim_id, outsider, db_session)

    assert raised.value.status_code == 403


def test_context_unknown_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        get_review_context(uuid.uuid4(), member, db_session)

    assert raised.value.status_code == 404


def test_context_non_uuid_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        get_review_context_endpoint("not-a-uuid", member, db_session)

    assert raised.value.status_code == 404


def test_context_non_completed_claim_is_409(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="approved")

    with pytest.raises(HTTPException) as raised:
        get_review_context(claim_id, requestor, db_session)

    assert raised.value.status_code == 409
    assert raised.value.detail == "You can only review a completed exchange."


def test_context_suspended_member_is_403(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    suspended = insert_member(db_session, status="suspended", email="sus@example.com")

    with pytest.raises(HTTPException) as raised:
        get_review_context(claim_id, suspended, db_session)

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail


def test_context_database_failure_is_503(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Member",
        email="member@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        get_review_context(uuid.uuid4(), member, broken_session)

    assert raised.value.status_code == 503


def test_get_review_context_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/claims/{claim_id}/review":
                if "GET" in route.methods:
                    found = True
    assert found


# ── PATCH: Rule 2, the edit path ──────────────────────────────────────────────


def test_edit_review_updates_in_place(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(
        claim_id, CreateReviewPayload(rating=3, body="ok"), owner, db_session
    )

    response = edit_review(
        claim_id, EditReviewPayload(rating=5, body="great"), owner, db_session
    )

    assert response.rating == 5
    assert response.body == "great"
    assert count_reviews(db_session) == 1

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.rating == 5
    assert row.body == "great"
    assert row.updated_at > row.created_at


def test_edit_review_does_not_touch_created_at(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    created = create_review(
        claim_id, CreateReviewPayload(rating=3, body="ok"), owner, db_session
    )

    edit_review(claim_id, EditReviewPayload(rating=4, body="better"), owner, db_session)

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.created_at == created.created_at


def test_edit_review_to_rating_only_stores_empty_body(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(
        claim_id, CreateReviewPayload(rating=3, body="something"), owner, db_session
    )

    response = edit_review(claim_id, EditReviewPayload(rating=4), owner, db_session)
    assert response.body == ""

    spaces = edit_review(
        claim_id, EditReviewPayload(rating=4, body="   "), owner, db_session
    )
    assert spaces.body == ""

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.body == ""


def test_edit_only_touches_the_acting_members_own_row(db_session):
    """Rule 2, author only: B's edit changes B's row and never A's. There is
    no review id anywhere in the request to aim at another member's review."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(
        claim_id, CreateReviewPayload(rating=2, body="owner wrote this"), owner, db_session
    )
    create_review(
        claim_id,
        CreateReviewPayload(rating=3, body="requestor wrote this"),
        requestor,
        db_session,
    )

    edit_review(
        claim_id, EditReviewPayload(rating=5, body="requestor edited"), requestor, db_session
    )

    owner_row = db_session.scalars(
        select(Review)
        .where(Review.claim_id == claim_id)
        .where(Review.reviewer_id == owner.id)
    ).first()
    requestor_row = db_session.scalars(
        select(Review)
        .where(Review.claim_id == claim_id)
        .where(Review.reviewer_id == requestor.id)
    ).first()

    assert owner_row.rating == 2
    assert owner_row.body == "owner wrote this"
    assert requestor_row.rating == 5
    assert requestor_row.body == "requestor edited"


# ── PATCH: Rule 3, the freeze ─────────────────────────────────────────────────


def test_edit_a_disabled_review_is_blocked_with_403(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        rating=4,
        body="original text",
        disabled_at=datetime.now(timezone.utc),
    )
    before = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    before_updated_at = before.updated_at

    with pytest.raises(HTTPException) as raised:
        edit_review(
            claim_id, EditReviewPayload(rating=1, body="sneaky edit"), owner, db_session
        )

    assert raised.value.status_code == 403
    assert raised.value.detail == DISABLED_REVIEW_MESSAGE
    assert "administrator" in raised.value.detail
    assert "disabled" in raised.value.detail

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.rating == 4
    assert row.body == "original text"
    assert row.updated_at == before_updated_at


def test_disabled_blocks_on_create_and_edit_use_the_same_message(db_session):
    """The two 403 details are byte-for-byte equal, so the member reads the
    same sentence whichever action they try."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        disabled_at=datetime.now(timezone.utc),
    )

    with pytest.raises(HTTPException) as create_raised:
        create_review(claim_id, make_review_payload(), owner, db_session)
    with pytest.raises(HTTPException) as edit_raised:
        edit_review(claim_id, make_edit_payload(), owner, db_session)

    assert create_raised.value.status_code == 403
    assert edit_raised.value.status_code == 403
    assert create_raised.value.detail == edit_raised.value.detail


# ── PATCH: the remaining guards ───────────────────────────────────────────────


def test_edit_with_no_existing_review_is_404(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    with pytest.raises(HTTPException) as raised:
        edit_review(claim_id, make_edit_payload(), owner, db_session)

    assert raised.value.status_code == 404
    assert raised.value.detail == "You have not reviewed this exchange yet."
    assert count_reviews(db_session) == 0


def test_non_participant_cannot_edit(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    outsider = insert_member(db_session, email="outsider@example.com", name="Oscar Outsider")

    with pytest.raises(HTTPException) as raised:
        edit_review(claim_id, make_edit_payload(), outsider, db_session)

    assert raised.value.status_code == 403

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row.rating == 4
    assert row.body == "Great to work with."


def test_edit_payload_rejects_rating_out_of_bounds():
    with pytest.raises(ValidationError):
        EditReviewPayload(rating=0)
    with pytest.raises(ValidationError):
        EditReviewPayload(rating=6)


def test_edit_payload_body_length_bounds():
    with pytest.raises(ValidationError):
        EditReviewPayload(rating=3, body="x" * 1001)
    at_limit = EditReviewPayload(rating=3, body="x" * 1000)
    assert len(at_limit.body) == 1000


def test_edit_review_non_uuid_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        edit_review_endpoint("not-a-uuid", make_edit_payload(), member, db_session)

    assert raised.value.status_code == 404


def test_edit_review_non_completed_claim_is_409(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="picked_up")

    with pytest.raises(HTTPException) as raised:
        edit_review(claim_id, make_edit_payload(), requestor, db_session)

    assert raised.value.status_code == 409


def test_suspended_member_cannot_edit(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    suspended = insert_member(db_session, status="suspended", email="sus@example.com")

    with pytest.raises(HTTPException) as raised:
        edit_review(claim_id, make_edit_payload(), suspended, db_session)

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail


def test_edit_review_database_failure_is_503(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Member",
        email="member@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        edit_review(uuid.uuid4(), make_edit_payload(), member, broken_session)

    assert raised.value.status_code == 503


def test_edit_review_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/claims/{claim_id}/review":
                if "PATCH" in route.methods:
                    found = True
    assert found


# ── the HTTP wrappers with a valid claim id ───────────────────────────────────


def test_wrappers_pass_a_valid_claim_id_through_to_the_cores(db_session):
    """Each wrapper parses a valid UUID string and returns the core's result."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    created = create_review_endpoint(str(claim_id), make_review_payload(), owner, db_session)
    assert created.rating == 4

    context = get_review_context_endpoint(str(claim_id), owner, db_session)
    assert context.already_reviewed is True

    edited = edit_review_endpoint(str(claim_id), make_edit_payload(), owner, db_session)
    assert edited.rating == 5


# ── the database dying partway through a request ──────────────────────────────
# BrokenSession only reaches the first query's error branch, so these use
# DiesMidRequestSession to reach each later branch: the reads are counted per
# endpoint (GET: claim, listing, other party, existing review; POST: claim,
# listing, duplicate check; PATCH: claim, listing, review to edit).


def test_helper_listing_load_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=1)

    with pytest.raises(HTTPException) as raised:
        get_review_context(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_context_other_party_load_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=2)

    with pytest.raises(HTTPException) as raised:
        get_review_context(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_context_existing_review_load_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=3)

    with pytest.raises(HTTPException) as raised:
        get_review_context(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_create_duplicate_check_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=2)

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), owner, dying)

    assert raised.value.status_code == 503


def test_create_commit_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=99, fail_commit=True)

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), owner, dying)

    assert raised.value.status_code == 503


def test_create_integrity_error_on_flush_is_the_duplicate_409(db_session):
    """The race backstop: when the unique constraint rejects the insert, the
    caller gets the same 409 as the ordinary duplicate."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    flush_error = IntegrityError("statement", {}, Exception("duplicate key"))
    dying = DiesMidRequestSession(db_session, allowed_reads=99, flush_error=flush_error)

    with pytest.raises(HTTPException) as raised:
        create_review(claim_id, make_review_payload(), owner, dying)

    assert raised.value.status_code == 409
    assert raised.value.detail == "You have already reviewed this exchange."


def test_edit_review_load_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=2)

    with pytest.raises(HTTPException) as raised:
        edit_review(claim_id, make_edit_payload(), owner, dying)

    assert raised.value.status_code == 503


def test_edit_commit_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=99, fail_commit=True)

    with pytest.raises(HTTPException) as raised:
        edit_review(claim_id, make_edit_payload(), owner, dying)

    assert raised.value.status_code == 503


# ── DELETE: Rule 4, a reviewer removes their own review ───────────────────────


def test_delete_removes_the_acting_members_review(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)

    result = delete_review(claim_id, owner, db_session)

    assert result is None
    assert count_reviews(db_session) == 0


def test_delete_only_removes_the_acting_members_own_row(db_session):
    """Rule 4, author only: the owner's delete takes the owner's row and
    leaves the requestor's row exactly as it was."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(
        claim_id, CreateReviewPayload(rating=2, body="owner wrote this"), owner, db_session
    )
    create_review(
        claim_id,
        CreateReviewPayload(rating=3, body="requestor wrote this"),
        requestor,
        db_session,
    )

    delete_review(claim_id, owner, db_session)

    owner_row = db_session.scalars(
        select(Review)
        .where(Review.claim_id == claim_id)
        .where(Review.reviewer_id == owner.id)
    ).first()
    requestor_row = db_session.scalars(
        select(Review)
        .where(Review.claim_id == claim_id)
        .where(Review.reviewer_id == requestor.id)
    ).first()

    assert owner_row is None
    assert requestor_row is not None
    assert requestor_row.rating == 3
    assert requestor_row.body == "requestor wrote this"
    assert count_reviews(db_session) == 1


def test_delete_is_idempotent(db_session):
    """The double-click case: the second and third deletes are quiet
    successes, and neither reaches the other member's row."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    create_review(claim_id, make_review_payload(), requestor, db_session)

    first = delete_review(claim_id, owner, db_session)
    second = delete_review(claim_id, owner, db_session)
    third = delete_review(claim_id, owner, db_session)

    assert first is None
    assert second is None
    assert third is None
    assert count_reviews(db_session) == 1


def test_delete_with_no_review_at_all_is_a_quiet_success(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    result = delete_review(claim_id, owner, db_session)

    assert result is None
    assert count_reviews(db_session) == 0


def test_a_participant_cannot_delete_the_other_partys_review(db_session):
    """The forged-request case: the requestor asks to delete on an exchange
    where only the owner has written a review. The query is scoped to the
    caller, so it finds nothing and the owner's review survives."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)

    result = delete_review(claim_id, requestor, db_session)

    assert result is None
    owner_row = db_session.scalars(
        select(Review)
        .where(Review.claim_id == claim_id)
        .where(Review.reviewer_id == owner.id)
    ).first()
    assert owner_row is not None
    assert owner_row.rating == 4
    assert count_reviews(db_session) == 1


def test_non_participant_cannot_delete(db_session):
    """A member who took no part in the exchange is refused, and both reviews
    survive."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    create_review(claim_id, make_review_payload(), requestor, db_session)
    outsider = insert_member(db_session, email="outsider@example.com", name="Oscar Outsider")

    with pytest.raises(HTTPException) as raised:
        delete_review(claim_id, outsider, db_session)

    assert raised.value.status_code == 403
    assert count_reviews(db_session) == 2


def test_suspended_member_cannot_delete(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    suspended = insert_member(db_session, status="suspended", email="sus@example.com")

    with pytest.raises(HTTPException) as raised:
        delete_review(claim_id, suspended, db_session)

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail
    assert count_reviews(db_session) == 1


def test_delete_a_disabled_review_is_blocked_with_403(db_session):
    """Rule 3 wins over Rule 4: a review an administrator disabled stays as
    the record of what happened."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        rating=4,
        body="original text",
        disabled_at=datetime.now(timezone.utc),
    )

    with pytest.raises(HTTPException) as raised:
        delete_review(claim_id, owner, db_session)

    assert raised.value.status_code == 403
    assert raised.value.detail == DISABLED_REVIEW_DELETE_MESSAGE
    assert "administrator" in raised.value.detail
    assert "disabled" in raised.value.detail

    row = db_session.scalars(select(Review).where(Review.claim_id == claim_id)).first()
    assert row is not None
    assert row.body == "original text"


def test_the_disabled_blocks_share_one_opening_sentence(db_session):
    """The edit refusal and the delete refusal explain the reason with the
    same words, so a member reads one story whichever action they try."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        disabled_at=datetime.now(timezone.utc),
    )

    with pytest.raises(HTTPException) as edit_raised:
        edit_review(claim_id, make_edit_payload(), owner, db_session)
    with pytest.raises(HTTPException) as delete_raised:
        delete_review(claim_id, owner, db_session)

    shared = "An administrator disabled your review for this exchange"
    assert edit_raised.value.detail.startswith(shared)
    assert delete_raised.value.detail.startswith(shared)
    assert DISABLED_REVIEW_MESSAGE != DISABLED_REVIEW_DELETE_MESSAGE


def test_after_a_delete_the_member_may_write_a_new_review(db_session):
    """Deleting frees the member's one slot for the exchange, so the unique
    constraint no longer stands in the way of a fresh review."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(
        claim_id, CreateReviewPayload(rating=1, body="first try"), owner, db_session
    )

    delete_review(claim_id, owner, db_session)
    again = create_review(
        claim_id, CreateReviewPayload(rating=5, body="second try"), owner, db_session
    )

    assert again.rating == 5
    assert again.body == "second try"
    assert count_reviews(db_session) == 1


def test_context_after_a_delete_offers_the_empty_form_again(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)

    delete_review(claim_id, owner, db_session)
    context = get_review_context(claim_id, owner, db_session)

    assert context.already_reviewed is False
    assert context.existing_review is None
    assert context.can_edit is False


def test_delete_review_unknown_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        delete_review(uuid.uuid4(), member, db_session)

    assert raised.value.status_code == 404


def test_delete_review_non_uuid_claim_is_404(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        delete_review_endpoint("not-a-uuid", member, db_session)

    assert raised.value.status_code == 404


def test_delete_review_non_completed_claim_is_409(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="picked_up")

    with pytest.raises(HTTPException) as raised:
        delete_review(claim_id, requestor, db_session)

    assert raised.value.status_code == 409


def test_delete_review_endpoint_deletes_with_a_valid_claim_id(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)

    result = delete_review_endpoint(str(claim_id), owner, db_session)

    assert result is None
    assert count_reviews(db_session) == 0


def test_delete_review_database_failure_is_503(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Member",
        email="member@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        delete_review(uuid.uuid4(), member, broken_session)

    assert raised.value.status_code == 503


def test_delete_review_load_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=2)

    with pytest.raises(HTTPException) as raised:
        delete_review(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_delete_commit_failure_is_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    create_review(claim_id, make_review_payload(), owner, db_session)
    dying = DiesMidRequestSession(db_session, allowed_reads=99, fail_commit=True)

    with pytest.raises(HTTPException) as raised:
        delete_review(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_delete_review_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    status_code = 0
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/claims/{claim_id}/review":
                if "DELETE" in route.methods:
                    found = True
                    status_code = route.status_code
    assert found
    assert status_code == 204
