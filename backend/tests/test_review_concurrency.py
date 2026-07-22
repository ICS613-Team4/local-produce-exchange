# Concurrency tests for the review endpoints (US-20). These prove the row
# locks in the routes hold under a real race: two review submissions at once
# leave exactly one row, and an edit racing an admin disable can never commit
# new text to a review that was already disabled when the edit read it.
#
# Unlike the other review tests, these do NOT use the db_session fixture. That
# fixture hands every caller one shared connection inside one transaction, which
# cannot show real row locks between connections. Instead each thread here opens
# its own real session (its own connection), the way two separate web requests
# would, so the SELECT ... FOR UPDATE locks actually contend. The data is
# committed for real and cleaned up at the end.

import threading
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range

from app.db import SessionLocal
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.review import Review
from app.routers.review import create_review, edit_review
from app.schemas.review import CreateReviewPayload, EditReviewPayload


def make_active_member_stub(member_id):
    # A detached Member with only the fields the review cores read (id and
    # status). It is never added to a session, so it needs no real row.
    member = Member(
        id=member_id,
        name="Reviewer",
        email="unused@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    return member


def insert_committed_completed_exchange():
    # Commit an owner, a requestor, a listing, and a COMPLETED claim for real,
    # so two independent sessions can both see them. Returns the ids needed.
    session = SessionLocal()
    try:
        owner = Member(
            name="Owner",
            email="review-race-owner@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        requestor = Member(
            name="Requestor",
            email="review-race-requestor@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        session.add(owner)
        session.add(requestor)
        session.commit()
        owner_id = owner.id
        requestor_id = requestor.id

        start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
        end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
        listing = Listing(
            owner_id=owner_id,
            title="Fresh Tomatoes",
            description="Ripe red tomatoes.",
            category="Vegetables",
            dietary_tags=[],
            allergen_tags=[],
            total_quantity=5,
            remaining_quantity=3,
            pickup_window=Range(start, end, bounds="[)"),
            status="active",
        )
        session.add(listing)
        session.commit()
        listing_id = listing.id

        claim = Claim(
            listing_id=listing_id,
            claimant_id=requestor_id,
            requested_quantity=2,
            approved_quantity=2,
            status="completed",
            requested_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
        session.add(claim)
        session.commit()

        ids = {
            "owner_id": owner_id,
            "requestor_id": requestor_id,
            "listing_id": listing_id,
            "claim_id": claim.id,
        }
        return ids
    finally:
        session.close()


def insert_committed_review(claim_id, reviewer_id, reviewee_id, rating, body):
    # Commit one live review for real, so both racing sessions can see it.
    session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        review = Review(
            claim_id=claim_id,
            reviewer_id=reviewer_id,
            reviewee_id=reviewee_id,
            reviewee_role="requestor",
            rating=rating,
            body=body,
            created_at=now,
            updated_at=now,
        )
        session.add(review)
        session.commit()
        return review.id
    finally:
        session.close()


def clean_up_exchange(ids):
    # Remove the committed rows so this test does not leak into the next.
    session = SessionLocal()
    try:
        session.execute(delete(Review).where(Review.claim_id == ids["claim_id"]))
        session.execute(delete(Claim).where(Claim.id == ids["claim_id"]))
        session.execute(delete(Listing).where(Listing.id == ids["listing_id"]))
        session.execute(delete(Member).where(Member.id == ids["requestor_id"]))
        session.execute(delete(Member).where(Member.id == ids["owner_id"]))
        session.commit()
    finally:
        session.close()


def count_reviews_for_claim(claim_id):
    session = SessionLocal()
    try:
        rows = session.scalars(select(Review).where(Review.claim_id == claim_id)).all()
        return len(rows)
    finally:
        session.close()


def load_review(review_id):
    # Read the committed end state of one review row.
    session = SessionLocal()
    try:
        row = session.scalars(select(Review).where(Review.id == review_id)).first()
        state = {
            "rating": row.rating,
            "body": row.body,
            "disabled_at": row.disabled_at,
        }
        return state
    finally:
        session.close()


def test_two_concurrent_submissions_by_the_same_member_leave_one_row():
    """Rule 1 under a real race: the claim row lock serializes the two
    submissions, and the uq_review_claim_reviewer constraint backstops them,
    so exactly one review lands and the other caller gets 409.
    """
    ids = insert_committed_completed_exchange()
    try:
        results = {}
        barrier = threading.Barrier(2)

        def do_create(key):
            session = SessionLocal()
            try:
                member = make_active_member_stub(ids["owner_id"])
                payload = CreateReviewPayload(rating=4, body="race attempt " + key)
                # Wait so both threads start the submission together.
                barrier.wait()
                try:
                    response = create_review(ids["claim_id"], payload, member, session)
                    results[key] = ("ok", response.id)
                except HTTPException as raised:
                    results[key] = ("error", raised.status_code)
            finally:
                session.close()

        thread_a = threading.Thread(target=do_create, args=("a",))
        thread_b = threading.Thread(target=do_create, args=("b",))
        thread_a.start()
        thread_b.start()
        thread_a.join()
        thread_b.join()

        outcomes = []
        outcomes.append(results["a"][0])
        outcomes.append(results["b"][0])
        assert outcomes.count("ok") == 1
        assert outcomes.count("error") == 1
        for key in results:
            if results[key][0] == "error":
                assert results[key][1] == 409

        assert count_reviews_for_claim(ids["claim_id"]) == 1
    finally:
        clean_up_exchange(ids)


def test_edit_racing_a_disable_never_edits_a_frozen_review():
    """Rule 3 under contention: the edit locks the review row before its
    freeze check, so an edit and an admin disable serialize. Exactly two end
    states are allowed, and the forbidden third (new text committed to a row
    that was already disabled when the edit read it) never happens.

    The disable is hand-written here as a locked UPDATE because no admin
    endpoint exists yet; when the admin disable action is built, it must take
    this same review-row lock.
    """
    ids = insert_committed_completed_exchange()
    try:
        review_id = insert_committed_review(
            ids["claim_id"], ids["owner_id"], ids["requestor_id"], 3, "original text"
        )

        results = {}
        barrier = threading.Barrier(2)

        def do_edit():
            session = SessionLocal()
            try:
                member = make_active_member_stub(ids["owner_id"])
                payload = EditReviewPayload(rating=5, body="edited text")
                barrier.wait()
                try:
                    edit_review(ids["claim_id"], payload, member, session)
                    results["edit"] = ("ok", None)
                except HTTPException as raised:
                    results["edit"] = ("error", raised.status_code)
            finally:
                session.close()

        def do_disable():
            # The stand-in for the future admin action: lock the review row,
            # set disabled_at, commit.
            session = SessionLocal()
            try:
                barrier.wait()
                row = session.scalars(
                    select(Review).where(Review.id == review_id).with_for_update()
                ).first()
                row.disabled_at = datetime.now(timezone.utc)
                session.commit()
                results["disable"] = ("ok", None)
            finally:
                session.close()

        edit_thread = threading.Thread(target=do_edit)
        disable_thread = threading.Thread(target=do_disable)
        edit_thread.start()
        disable_thread.start()
        edit_thread.join()
        disable_thread.join()

        assert results["disable"][0] == "ok"

        end_state = load_review(review_id)
        # The disable always lands, whichever side won the lock.
        assert end_state["disabled_at"] is not None

        if results["edit"][0] == "ok":
            # The edit got the lock first: it committed the new text, then the
            # disable froze the edited row.
            assert end_state["rating"] == 5
            assert end_state["body"] == "edited text"
        else:
            # The disable got the lock first: the edit saw disabled_at set on
            # the locked row, raised 403, and changed nothing.
            assert results["edit"][1] == 403
            assert end_state["rating"] == 3
            assert end_state["body"] == "original text"

        # Either way there is still exactly one review: editing never inserts.
        assert count_reviews_for_claim(ids["claim_id"]) == 1
    finally:
        clean_up_exchange(ids)
