# Tests for the two read-only review endpoints (US-21).
# Run from the project root with: npm run test:backend
#
# Two surfaces are covered here:
#   1. get_reviews_for_claim() - the reviews for one completed exchange, which
#      only the two participants may read (UC-20, scenarios 1, 2, and 3).
#   2. get_member_reviews() - the reviews behind one member's star rating for
#      ONE of their two roles, which any logged-in member may read.
#
# The cores are called directly with a real Postgres session from conftest.py;
# the HTTP wrappers are called directly too, with the dependencies passed in.
# US-20's own tests live in test_review.py and are not touched here.

import inspect
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError

from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.review import Review
from app.routers.claim import load_requestor_ratings
from app.routers.review import (
    get_member_reviews,
    get_member_reviews_endpoint,
    get_reviews_for_claim,
    get_reviews_for_claim_endpoint,
)


# ── helpers ──────────────────────────────────────────────────────────────────
#
# The project keeps test helpers local to each test file, so these mirror the
# ones in test_review.py rather than importing them.


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


def insert_listing(session, owner, title="Fresh Tomatoes"):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
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
    created_at=None,
):
    # created_at is settable so the ordering tests can space two reviews apart
    # instead of relying on how fast the test machine inserts rows.
    now = datetime.now(timezone.utc)
    if created_at is None:
        created_at = now
    review = Review(
        claim_id=claim_id,
        reviewer_id=reviewer.id,
        reviewee_id=reviewee.id,
        reviewee_role=reviewee_role,
        rating=rating,
        body=body,
        created_at=created_at,
        updated_at=created_at,
        disabled_at=disabled_at,
        disabled_by=disabled_by,
    )
    session.add(review)
    session.commit()
    return review.id


def make_completed_exchange(session):
    """An owner, a requestor, a listing, and a completed claim between them."""
    owner = insert_member(session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(session, owner)
    claim_id = insert_claim(session, listing.id, requestor, status="completed")
    return owner, requestor, listing, claim_id


def find_review_by_reviewer(response, reviewer):
    """The one item in a response written by this member, or None."""
    for item in response.reviews:
        if item.reviewer_id == str(reviewer.id):
            return item
    return None


class EmptyResult:
    # Stands in for a SQLAlchemy result that found nothing.
    def first(self):
        return None

    def all(self):
        return []


class DiesMidReadSession:
    # A session that serves the first few reads for real and then fails, so a
    # test can reach a try/except deeper in the route. conftest's
    # broken_session fails on the very first call, which only ever reaches the
    # first one.
    def __init__(self, real_session, allowed_scalars, allowed_executes=0):
        self.real_session = real_session
        self.remaining_scalars = allowed_scalars
        self.remaining_executes = allowed_executes

    def scalars(self, *args, **kwargs):
        if self.remaining_scalars <= 0:
            raise OperationalError("statement", {}, Exception("database died"))
        self.remaining_scalars = self.remaining_scalars - 1
        return self.real_session.scalars(*args, **kwargs)

    def execute(self, *args, **kwargs):
        if self.remaining_executes <= 0:
            raise OperationalError("statement", {}, Exception("database died"))
        self.remaining_executes = self.remaining_executes - 1
        return self.real_session.execute(*args, **kwargs)


class MissingParticipantsSession:
    # Loads the claim and the listing for real, then reports that the members
    # behind them are gone. Foreign keys make that impossible in the real
    # database, so this stand-in is the only way to reach the route's
    # defensive "Exchange not found." branch.
    def __init__(self, real_session, real_reads):
        self.real_session = real_session
        self.remaining_real_reads = real_reads

    def scalars(self, *args, **kwargs):
        if self.remaining_real_reads > 0:
            self.remaining_real_reads = self.remaining_real_reads - 1
            return self.real_session.scalars(*args, **kwargs)
        return EmptyResult()


# ── GET /api/claims/{claim_id}/reviews : scenario 1 ───────────────────────────


def test_the_poster_sees_both_reviews_including_the_one_about_them(db_session):
    """Scenario 1 from the owner's side: both reviews, correctly labelled."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session, claim_id, owner, requestor, "requestor", rating=5, body="On time."
    )
    insert_review(
        db_session, claim_id, requestor, owner, "listing_owner", rating=4, body="Great produce."
    )

    response = get_reviews_for_claim(claim_id, owner, db_session)

    assert response.claim_id == str(claim_id)
    assert response.listing_title == listing.title
    assert len(response.reviews) == 2

    about_owner = find_review_by_reviewer(response, requestor)
    assert about_owner is not None
    assert about_owner.about_viewer is True
    assert about_owner.by_viewer is False
    assert about_owner.reviewer_name == "Rita Requestor"
    assert about_owner.reviewee_name == "Owen Owner"
    assert about_owner.reviewee_role == "listing_owner"
    assert about_owner.rating == 4
    assert about_owner.body == "Great produce."

    by_owner = find_review_by_reviewer(response, owner)
    assert by_owner is not None
    assert by_owner.about_viewer is False
    assert by_owner.by_viewer is True
    assert by_owner.reviewee_role == "requestor"
    assert by_owner.rating == 5
    assert by_owner.body == "On time."


def test_the_recipient_sees_the_same_two_reviews_with_the_flags_swapped(db_session):
    """Scenario 1 from the requestor's side: the same rows, mirrored flags."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(db_session, claim_id, owner, requestor, "requestor", rating=5)
    insert_review(db_session, claim_id, requestor, owner, "listing_owner", rating=4)

    response = get_reviews_for_claim(claim_id, requestor, db_session)

    assert len(response.reviews) == 2

    about_requestor = find_review_by_reviewer(response, owner)
    assert about_requestor.about_viewer is True
    assert about_requestor.by_viewer is False

    by_requestor = find_review_by_reviewer(response, requestor)
    assert by_requestor.about_viewer is False
    assert by_requestor.by_viewer is True


def test_one_review_only_reads_correctly_from_both_sides(db_session):
    """Only the owner has reviewed: each side sees the one row, labelled for them."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(
        db_session, claim_id, owner, requestor, "requestor", rating=2, body="Late."
    )

    owner_view = get_reviews_for_claim(claim_id, owner, db_session)
    assert len(owner_view.reviews) == 1
    assert owner_view.reviews[0].by_viewer is True
    assert owner_view.reviews[0].about_viewer is False

    requestor_view = get_reviews_for_claim(claim_id, requestor, db_session)
    assert len(requestor_view.reviews) == 1
    assert requestor_view.reviews[0].by_viewer is False
    assert requestor_view.reviews[0].about_viewer is True


def test_the_reviews_for_an_exchange_come_back_oldest_first(db_session):
    """The two participants' reviews read as a small conversation."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    earlier = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    later = earlier + timedelta(hours=3)
    insert_review(
        db_session,
        claim_id,
        requestor,
        owner,
        "listing_owner",
        body="second",
        created_at=later,
    )
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        body="first",
        created_at=earlier,
    )

    response = get_reviews_for_claim(claim_id, owner, db_session)

    assert response.reviews[0].body == "first"
    assert response.reviews[1].body == "second"


# ── GET /api/claims/{claim_id}/reviews : scenario 2, the empty state ──────────


def test_a_completed_exchange_with_no_reviews_returns_an_empty_list(db_session):
    """Scenario 2: no reviews yet is an empty list, not an error."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)

    response = get_reviews_for_claim(claim_id, owner, db_session)

    assert response.reviews == []
    assert response.listing_title == listing.title


def test_an_exchange_whose_only_review_is_disabled_looks_empty(db_session):
    """A disabled review is never shown, so the page shows the empty state."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    admin = insert_member(db_session, email="admin@example.com", name="Ada Admin")
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        body="hidden",
        disabled_at=datetime.now(timezone.utc),
        disabled_by=admin.id,
    )

    response = get_reviews_for_claim(claim_id, owner, db_session)

    assert response.reviews == []


def test_a_disabled_review_is_dropped_but_the_live_one_stays(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    admin = insert_member(db_session, email="admin@example.com", name="Ada Admin")
    insert_review(
        db_session,
        claim_id,
        owner,
        requestor,
        "requestor",
        body="hidden",
        disabled_at=datetime.now(timezone.utc),
        disabled_by=admin.id,
    )
    insert_review(
        db_session, claim_id, requestor, owner, "listing_owner", body="still here"
    )

    response = get_reviews_for_claim(claim_id, owner, db_session)

    assert len(response.reviews) == 1
    assert response.reviews[0].body == "still here"


# ── GET /api/claims/{claim_id}/reviews : scenario 3, the participant rule ─────


def test_a_member_who_took_no_part_is_denied(db_session):
    """Scenario 3: a stranger gets 403 and reads nothing."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(db_session, claim_id, owner, requestor, "requestor")
    stranger = insert_member(db_session, email="stranger@example.com", name="Sam Stranger")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, stranger, db_session)

    assert raised.value.status_code == 403


def test_a_stranger_is_denied_before_the_status_is_ever_checked(db_session):
    """The participant check runs first, so a stranger never learns the status."""
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="approved")
    stranger = insert_member(db_session, email="stranger@example.com", name="Sam Stranger")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, stranger, db_session)

    # 403, not the 409 a participant would get on this same claim.
    assert raised.value.status_code == 403


@pytest.mark.parametrize(
    "status", ["requested", "approved", "picked_up", "denied", "cancelled"]
)
def test_a_participant_on_an_unfinished_exchange_gets_a_conflict(db_session, status):
    """Reviews exist only for a completed exchange."""
    owner = insert_member(db_session, email="owner@example.com", name="Owen Owner")
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status=status)

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, owner, db_session)

    assert raised.value.status_code == 409
    assert "completed" in raised.value.detail


# ── GET /api/claims/{claim_id}/reviews : the guards ───────────────────────────


def test_an_unknown_claim_id_is_not_found(db_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim_endpoint(
            claim_id=str(uuid.uuid4()), current_member=member, session=db_session
        )

    assert raised.value.status_code == 404


def test_a_claim_id_that_is_not_a_uuid_is_not_found(db_session):
    """A malformed id is a 404, never a 500."""
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim_endpoint(
            claim_id="not-a-uuid", current_member=member, session=db_session
        )

    assert raised.value.status_code == 404


def test_the_wrapper_passes_a_valid_claim_id_through(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    insert_review(db_session, claim_id, owner, requestor, "requestor", body="passed through")

    response = get_reviews_for_claim_endpoint(
        claim_id=str(claim_id), current_member=owner, session=db_session
    )

    assert response.reviews[0].body == "passed through"


def test_a_suspended_participant_cannot_read_the_reviews(db_session):
    owner = insert_member(
        db_session, status="suspended", email="owner@example.com", name="Owen Owner"
    )
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="completed")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, owner, db_session)

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail


def test_an_inactive_participant_cannot_read_the_reviews(db_session):
    owner = insert_member(
        db_session, status="inactive", email="owner@example.com", name="Owen Owner"
    )
    requestor = insert_member(db_session, email="requestor@example.com", name="Rita Requestor")
    listing = insert_listing(db_session, owner)
    claim_id = insert_claim(db_session, listing.id, requestor, status="completed")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, owner, db_session)

    assert raised.value.status_code == 403
    assert "not active" in raised.value.detail


def test_a_dead_database_gives_a_service_unavailable(db_session, broken_session):
    member = insert_member(db_session, email="member@example.com")

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(uuid.uuid4(), member, broken_session)

    assert raised.value.status_code == 503


def test_a_database_that_dies_loading_the_participants_gives_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    # Two reads succeed (the claim and the listing), then the participant load
    # fails.
    dying = DiesMidReadSession(db_session, allowed_scalars=2)

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_a_database_that_dies_loading_the_reviews_gives_503(db_session):
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    # Four reads succeed (claim, listing, poster, recipient), then the review
    # load fails.
    dying = DiesMidReadSession(db_session, allowed_scalars=4)

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, owner, dying)

    assert raised.value.status_code == 503


def test_an_exchange_whose_participants_vanished_is_not_found(db_session):
    """The defensive branch: no poster or recipient row means no exchange."""
    owner, requestor, listing, claim_id = make_completed_exchange(db_session)
    session = MissingParticipantsSession(db_session, real_reads=2)

    with pytest.raises(HTTPException) as raised:
        get_reviews_for_claim(claim_id, owner, session)

    assert raised.value.status_code == 404


def test_the_get_reviews_route_is_wired_up():
    from app.main import app

    found_get = False
    found_post = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/claims/{claim_id}/reviews":
                if "GET" in route.methods:
                    found_get = True
                if "POST" in route.methods:
                    found_post = True
    assert found_get
    # US-20's create route shares the path and must still be registered.
    assert found_post


# ── GET /api/members/{member_id}/reviews : the two roles stay apart ───────────


def build_member_with_both_reputations(session):
    """One member reviewed twice as an owner (5 and 3) and once as a requestor (1)."""
    bob = insert_member(session, email="bob@example.com", name="Bob Baker")
    carol = insert_member(session, email="carol@example.com", name="Carol Chen")

    # Bob posts twice and Carol reviews him as a listing owner.
    first_listing = insert_listing(session, bob, title="Bob's Tomatoes")
    first_claim = insert_claim(session, first_listing.id, carol, status="completed")
    insert_review(
        session, first_claim, carol, bob, "listing_owner", rating=5, body="Great produce."
    )

    second_listing = insert_listing(session, bob, title="Bob's Basil")
    second_claim = insert_claim(session, second_listing.id, carol, status="completed")
    insert_review(
        session, second_claim, carol, bob, "listing_owner", rating=3, body="Fine."
    )

    # Carol posts and reviews Bob as a requestor.
    third_listing = insert_listing(session, carol, title="Carol's Kale")
    third_claim = insert_claim(session, third_listing.id, bob, status="completed")
    insert_review(
        session, third_claim, carol, bob, "requestor", rating=1, body="Late to the pickup."
    )

    return bob, carol


def test_the_listing_owner_role_returns_only_the_listing_owner_reviews(db_session):
    """The core promise of the clickable rating: the wrong role never leaks in."""
    bob, carol = build_member_with_both_reputations(db_session)

    response = get_member_reviews(bob.id, "listing_owner", db_session)

    assert response.member_id == str(bob.id)
    assert response.member_name == "Bob Baker"
    assert response.role == "listing_owner"
    assert response.count == 2
    assert response.average == 4.0
    bodies = []
    for item in response.reviews:
        bodies.append(item.body)
    assert "Great produce." in bodies
    assert "Fine." in bodies
    assert "Late to the pickup." not in bodies


def test_the_requestor_role_returns_only_the_requestor_reviews(db_session):
    bob, carol = build_member_with_both_reputations(db_session)

    response = get_member_reviews(bob.id, "requestor", db_session)

    assert response.role == "requestor"
    assert response.count == 1
    assert response.average == 1.0
    assert response.reviews[0].body == "Late to the pickup."


def test_the_averages_match_the_numbers_the_rating_chips_show(db_session):
    """The page's average must equal the average behind the chip that was clicked."""
    bob, carol = build_member_with_both_reputations(db_session)

    # The requestor side, against the helper the two queue endpoints use.
    requestor_response = get_member_reviews(bob.id, "requestor", db_session)
    chip_ratings = load_requestor_ratings(db_session, [bob.id])
    assert requestor_response.average == chip_ratings[bob.id]["average"]
    assert requestor_response.count == chip_ratings[bob.id]["count"]

    # The listing-owner side, against the same aggregation browse runs.
    owner_response = get_member_reviews(bob.id, "listing_owner", db_session)
    owner_row = db_session.execute(
        select(func.avg(Review.rating), func.count(Review.id))
        .where(Review.reviewee_id == bob.id)
        .where(Review.reviewee_role == "listing_owner")
        .where(Review.disabled_at.is_(None))
    ).first()
    assert owner_response.average == float(owner_row[0])
    assert owner_response.count == int(owner_row[1])


def test_a_members_reviews_come_back_newest_first(db_session):
    """A reputation feed reads newest first."""
    bob = insert_member(db_session, email="bob@example.com", name="Bob Baker")
    carol = insert_member(db_session, email="carol@example.com", name="Carol Chen")
    listing = insert_listing(db_session, bob)
    older_claim = insert_claim(db_session, listing.id, carol, status="completed")
    second_listing = insert_listing(db_session, bob, title="Second")
    newer_claim = insert_claim(db_session, second_listing.id, carol, status="completed")

    older = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    newer = older + timedelta(days=2)
    insert_review(
        db_session, older_claim, carol, bob, "listing_owner", body="older", created_at=older
    )
    insert_review(
        db_session, newer_claim, carol, bob, "listing_owner", body="newer", created_at=newer
    )

    response = get_member_reviews(bob.id, "listing_owner", db_session)

    assert response.reviews[0].body == "newer"
    assert response.reviews[1].body == "older"


def test_each_review_names_its_reviewer_and_its_listing(db_session):
    bob = insert_member(db_session, email="bob@example.com", name="Bob Baker")
    carol = insert_member(db_session, email="carol@example.com", name="Carol Chen")
    listing = insert_listing(db_session, bob, title="Bob's Tomatoes")
    claim_id = insert_claim(db_session, listing.id, carol, status="completed")
    insert_review(
        db_session, claim_id, carol, bob, "listing_owner", rating=5, body="Great produce."
    )

    response = get_member_reviews(bob.id, "listing_owner", db_session)

    item = response.reviews[0]
    assert item.reviewer_name == "Carol Chen"
    assert item.listing_id == str(listing.id)
    assert item.listing_title == "Bob's Tomatoes"
    assert item.rating == 5
    assert item.body == "Great produce."


def test_a_disabled_review_is_left_out_of_the_list_and_the_average(db_session):
    bob = insert_member(db_session, email="bob@example.com", name="Bob Baker")
    carol = insert_member(db_session, email="carol@example.com", name="Carol Chen")
    admin = insert_member(db_session, email="admin@example.com", name="Ada Admin")
    listing = insert_listing(db_session, bob)
    live_claim = insert_claim(db_session, listing.id, carol, status="completed")
    second_listing = insert_listing(db_session, bob, title="Second")
    hidden_claim = insert_claim(db_session, second_listing.id, carol, status="completed")

    insert_review(db_session, live_claim, carol, bob, "listing_owner", rating=4, body="live")
    insert_review(
        db_session,
        hidden_claim,
        carol,
        bob,
        "listing_owner",
        rating=1,
        body="hidden",
        disabled_at=datetime.now(timezone.utc),
        disabled_by=admin.id,
    )

    response = get_member_reviews(bob.id, "listing_owner", db_session)

    assert response.count == 1
    # 4.0, not the 2.5 the disabled row would drag it to.
    assert response.average == 4.0
    assert response.reviews[0].body == "live"


def test_a_member_with_no_reviews_in_this_role_has_no_average(db_session):
    """An empty role shows a message, not a zero score and not an error."""
    dave = insert_member(db_session, email="dave@example.com", name="Dave Diaz")

    response = get_member_reviews(dave.id, "listing_owner", db_session)

    assert response.count == 0
    assert response.average is None
    assert response.reviews == []
    assert response.member_name == "Dave Diaz"


def test_any_active_member_may_read_another_members_reviews(db_session):
    """Unlike the per-exchange view, this one has no participant rule."""
    bob, carol = build_member_with_both_reputations(db_session)
    outsider = insert_member(db_session, email="outsider@example.com", name="Olive Outsider")

    response = get_member_reviews_endpoint(
        member_id=str(bob.id),
        role="listing_owner",
        current_member=outsider,
        session=db_session,
    )

    assert response.count == 2
    assert response.average == 4.0


# ── GET /api/members/{member_id}/reviews : the guards ─────────────────────────


def test_an_unknown_member_id_is_not_found(db_session):
    with pytest.raises(HTTPException) as raised:
        get_member_reviews(uuid.uuid4(), "listing_owner", db_session)

    assert raised.value.status_code == 404
    assert raised.value.detail == "Member not found."


def test_a_member_id_that_is_not_a_uuid_is_not_found(db_session):
    caller = insert_member(db_session, email="caller@example.com")

    with pytest.raises(HTTPException) as raised:
        get_member_reviews_endpoint(
            member_id="not-a-uuid",
            role="listing_owner",
            current_member=caller,
            session=db_session,
        )

    assert raised.value.status_code == 404
    assert raised.value.detail == "Member not found."


def test_a_suspended_caller_cannot_read_a_members_reviews(db_session):
    bob = insert_member(db_session, email="bob@example.com", name="Bob Baker")
    caller = insert_member(db_session, status="suspended", email="caller@example.com")

    with pytest.raises(HTTPException) as raised:
        get_member_reviews_endpoint(
            member_id=str(bob.id),
            role="listing_owner",
            current_member=caller,
            session=db_session,
        )

    assert raised.value.status_code == 403
    assert "suspended" in raised.value.detail


def test_an_inactive_caller_cannot_read_a_members_reviews(db_session):
    bob = insert_member(db_session, email="bob@example.com", name="Bob Baker")
    caller = insert_member(db_session, status="inactive", email="caller@example.com")

    with pytest.raises(HTTPException) as raised:
        get_member_reviews_endpoint(
            member_id=str(bob.id),
            role="listing_owner",
            current_member=caller,
            session=db_session,
        )

    assert raised.value.status_code == 403
    assert "not active" in raised.value.detail


def test_a_caller_with_no_header_is_not_authenticated(db_session):
    """The 401 comes from the shared identity dependency this route depends on."""
    with pytest.raises(HTTPException) as raised:
        get_current_member(x_member_id=None, session=db_session)

    assert raised.value.status_code == 401


def test_a_caller_whose_header_names_nobody_is_not_authenticated(db_session):
    with pytest.raises(HTTPException) as raised:
        get_current_member(x_member_id=str(uuid.uuid4()), session=db_session)

    assert raised.value.status_code == 401


def test_the_member_reviews_route_uses_the_shared_identity_dependency():
    """So the two 401 cases above are the ones this route really produces."""
    parameters = inspect.signature(get_member_reviews_endpoint).parameters
    assert parameters["current_member"].default.dependency is get_current_member


def test_the_role_query_parameter_is_required_and_limited_to_the_two_roles():
    """A missing or unknown role is a 422 from FastAPI's own validation.

    The project has no HTTP test client dependency, so this reads the schema
    FastAPI generated from the route's Literal annotation. That schema is what
    drives the 422: a required parameter with exactly two allowed values.
    """
    from app.main import app

    schema = app.openapi()
    parameters = schema["paths"]["/api/members/{member_id}/reviews"]["get"]["parameters"]
    role_parameter = None
    for parameter in parameters:
        if parameter["name"] == "role":
            role_parameter = parameter
    assert role_parameter is not None
    assert role_parameter["in"] == "query"
    assert role_parameter["required"] is True
    assert role_parameter["schema"]["enum"] == ["listing_owner", "requestor"]


def test_a_dead_database_loading_the_member_gives_503(db_session, broken_session):
    with pytest.raises(HTTPException) as raised:
        get_member_reviews(uuid.uuid4(), "listing_owner", broken_session)

    assert raised.value.status_code == 503


def test_a_database_that_dies_loading_the_reviews_list_gives_503(db_session):
    bob = insert_member(db_session, email="bob@example.com", name="Bob Baker")
    # The member load succeeds; the review query is the one that fails.
    dying = DiesMidReadSession(db_session, allowed_scalars=1, allowed_executes=0)

    with pytest.raises(HTTPException) as raised:
        get_member_reviews(bob.id, "listing_owner", dying)

    assert raised.value.status_code == 503


def test_the_member_reviews_route_is_wired_up():
    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/members/{member_id}/reviews":
                if "GET" in route.methods:
                    found = True
    assert found
