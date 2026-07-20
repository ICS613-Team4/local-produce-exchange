# Concurrency tests for approve_claim. These prove the row locks in the route
# stop two approvals from over-allocating a listing, no matter how the poster
# clicks (two browser tabs, a double-click, or scripted clicks).
#
# Unlike the other claim tests, these do NOT use the db_session fixture. That
# fixture hands every caller one shared connection inside one transaction, which
# cannot show real row locks between connections. Instead each thread here opens
# its own real session (its own connection), the way two separate web requests
# would, so the SELECT ... FOR UPDATE locks actually contend. The data is
# committed for real and cleaned up at the end.

import threading
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range

from app.db import SessionLocal
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.notification import Notification
from app.routers.claim import approve_claim, create_claim
from app.schemas.claim import CreateClaimPayload


def make_active_member_stub(member_id):
    # A detached Member with only the fields approve_claim reads (id and status).
    # It is never added to a session, so it needs no real row.
    member = Member(
        id=member_id,
        name="Poster",
        email="unused@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    return member


def insert_committed_listing_with_two_claims(remaining_quantity, quantity_a, quantity_b):
    # Commit a poster, a listing, two claimants, and two pending claims for real,
    # so two independent sessions can both see them. Returns the ids needed.
    session = SessionLocal()
    try:
        poster = Member(
            name="Poster",
            email="race-poster@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        session.add(poster)
        session.commit()
        poster_id = poster.id

        start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
        end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
        listing = Listing(
            owner_id=poster_id,
            title="Fresh Tomatoes",
            description="Ripe red tomatoes.",
            category="Vegetables",
            dietary_tags=[],
            allergen_tags=[],
            total_quantity=remaining_quantity,
            remaining_quantity=remaining_quantity,
            pickup_window=Range(start, end, bounds="[)"),
            status="active",
        )
        session.add(listing)
        session.commit()
        listing_id = listing.id

        claimant_a = Member(
            name="A",
            email="race-a@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        claimant_b = Member(
            name="B",
            email="race-b@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        session.add(claimant_a)
        session.add(claimant_b)
        session.commit()

        claim_a = Claim(
            listing_id=listing_id,
            claimant_id=claimant_a.id,
            requested_quantity=quantity_a,
            status="requested",
            requested_at=datetime.now(timezone.utc),
        )
        claim_b = Claim(
            listing_id=listing_id,
            claimant_id=claimant_b.id,
            requested_quantity=quantity_b,
            status="requested",
            requested_at=datetime.now(timezone.utc),
        )
        session.add(claim_a)
        session.add(claim_b)
        session.commit()

        ids = {
            "poster_id": poster_id,
            "listing_id": listing_id,
            "claim_a_id": claim_a.id,
            "claim_b_id": claim_b.id,
        }
        return ids
    finally:
        session.close()


def insert_committed_listing_and_two_claimants(remaining_quantity):
    # Commit a poster, a listing, and two claimants, but NO claims yet. Each
    # thread in the request test makes its own claim. Returns the ids needed.
    session = SessionLocal()
    try:
        poster = Member(
            name="Poster",
            email="race-poster@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        session.add(poster)
        session.commit()
        poster_id = poster.id

        start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
        end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
        listing = Listing(
            owner_id=poster_id,
            title="Fresh Tomatoes",
            description="Ripe red tomatoes.",
            category="Vegetables",
            dietary_tags=[],
            allergen_tags=[],
            total_quantity=remaining_quantity,
            remaining_quantity=remaining_quantity,
            pickup_window=Range(start, end, bounds="[)"),
            status="active",
        )
        session.add(listing)
        session.commit()
        listing_id = listing.id

        claimant_a = Member(
            name="A",
            email="race-a@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        claimant_b = Member(
            name="B",
            email="race-b@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        session.add(claimant_a)
        session.add(claimant_b)
        session.commit()

        ids = {
            "poster_id": poster_id,
            "listing_id": listing_id,
            "claimant_a_id": claimant_a.id,
            "claimant_b_id": claimant_b.id,
        }
        return ids
    finally:
        session.close()


def clean_up_members_by_id(member_ids):
    # Remove any leftover member rows (used when a request test creates members
    # but, on an unexpected failure, no claims to find them through). The routes
    # these tests drive now save notifications (US-22), so delete those first or
    # their foreign keys block the member deletes.
    session = SessionLocal()
    try:
        for member_id in member_ids:
            session.execute(
                delete(Notification).where(Notification.member_id == member_id)
            )
        for member_id in member_ids:
            session.execute(delete(Member).where(Member.id == member_id))
        session.commit()
    finally:
        session.close()


def clean_up_listing(listing_id):
    # Remove the committed rows so this test does not leak into the next.
    session = SessionLocal()
    try:
        owner_id = None
        listing_row = session.scalars(
            select(Listing).where(Listing.id == listing_id)
        ).first()
        if listing_row is not None:
            owner_id = listing_row.owner_id
        claim_ids = []
        claimant_ids = []
        claim_rows = session.scalars(
            select(Claim).where(Claim.listing_id == listing_id)
        ).all()
        for claim_row in claim_rows:
            claim_ids.append(claim_row.id)
            claimant_ids.append(claim_row.claimant_id)

        # The routes these tests drive now save notifications (US-22). Delete
        # them first: their foreign keys to claim and member would otherwise
        # block the claim and member deletes below.
        for claim_id in claim_ids:
            session.execute(
                delete(Notification).where(Notification.claim_id == claim_id)
            )
        for claimant_id in claimant_ids:
            session.execute(
                delete(Notification).where(Notification.member_id == claimant_id)
            )
        if owner_id is not None:
            session.execute(
                delete(Notification).where(Notification.member_id == owner_id)
            )

        session.execute(delete(Claim).where(Claim.listing_id == listing_id))
        session.execute(delete(Listing).where(Listing.id == listing_id))
        for claimant_id in claimant_ids:
            session.execute(delete(Member).where(Member.id == claimant_id))
        if owner_id is not None:
            session.execute(delete(Member).where(Member.id == owner_id))
        session.commit()
    finally:
        session.close()


def run_two_approvals(poster_id, claim_a_id, claim_b_id):
    # Run two approvals at the same time, each in its own session, released
    # together by a barrier so they race. Returns each thread's outcome.
    poster = make_active_member_stub(poster_id)
    results = {}
    barrier = threading.Barrier(2)

    def do_approve(key, claim_id):
        session = SessionLocal()
        try:
            # Wait so both threads start the approval together.
            barrier.wait()
            try:
                response = approve_claim(str(claim_id), poster, session)
                results[key] = ("ok", response.approved_quantity)
            except HTTPException as raised:
                results[key] = ("error", raised.status_code)
        finally:
            session.close()

    thread_a = threading.Thread(target=do_approve, args=("a", claim_a_id))
    thread_b = threading.Thread(target=do_approve, args=("b", claim_b_id))
    thread_a.start()
    thread_b.start()
    thread_a.join()
    thread_b.join()
    return results


def run_two_requests(listing_id, claimant_a_id, claimant_b_id, quantity):
    # Two different members request the listing at the same time, each in its own
    # session, released together by a barrier so they race. Returns each
    # thread's outcome.
    results = {}
    barrier = threading.Barrier(2)

    def do_request(key, claimant_id):
        session = SessionLocal()
        try:
            member = make_active_member_stub(claimant_id)
            payload = CreateClaimPayload(quantity=quantity)
            # Wait so both threads start the request together.
            barrier.wait()
            try:
                response = create_claim(str(listing_id), payload, member, session)
                results[key] = ("ok", response.id)
            except HTTPException as raised:
                results[key] = ("error", raised.status_code)
        finally:
            session.close()

    thread_a = threading.Thread(target=do_request, args=("a", claimant_a_id))
    thread_b = threading.Thread(target=do_request, args=("b", claimant_b_id))
    thread_a.start()
    thread_b.start()
    thread_a.join()
    thread_b.join()
    return results


def pending_claim_ids(listing_id):
    session = SessionLocal()
    try:
        claim_ids = []
        claim_rows = session.scalars(
            select(Claim).where(Claim.listing_id == listing_id).where(Claim.status == "requested")
        ).all()
        for claim_row in claim_rows:
            claim_ids.append(claim_row.id)
        return claim_ids
    finally:
        session.close()


def total_approved_quantity(listing_id):
    session = SessionLocal()
    try:
        total = 0
        claim_rows = session.scalars(
            select(Claim).where(Claim.listing_id == listing_id)
        ).all()
        for claim_row in claim_rows:
            if claim_row.status == "approved":
                total += claim_row.approved_quantity
        return total
    finally:
        session.close()


def remaining_quantity(listing_id):
    session = SessionLocal()
    try:
        listing_row = session.scalars(
            select(Listing).where(Listing.id == listing_id)
        ).first()
        return listing_row.remaining_quantity
    finally:
        session.close()


def test_concurrent_approvals_on_one_listing_never_over_allocate():
    """Two requests for 5 against only 5 available cannot both be approved.

    Without the row lock both approvals could read remaining = 5 and each
    subtract 5, approving 10 against a stock of 5. The listing lock serializes
    them, so one is approved for 5 and the other is rejected, and the total
    approved is exactly 5.
    """
    ids = insert_committed_listing_with_two_claims(
        remaining_quantity=5, quantity_a=5, quantity_b=5
    )
    try:
        results = run_two_approvals(ids["poster_id"], ids["claim_a_id"], ids["claim_b_id"])

        # The core guarantee: never allocate more than the stock, never go below 0.
        approved_total = total_approved_quantity(ids["listing_id"])
        assert approved_total == 5
        assert remaining_quantity(ids["listing_id"]) == 0

        # Exactly one approval succeeded; the other was refused with a 409.
        outcomes = []
        outcomes.append(results["a"][0])
        outcomes.append(results["b"][0])
        assert outcomes.count("ok") == 1
        assert outcomes.count("error") == 1
        for key in results:
            if results[key][0] == "error":
                assert results[key][1] == 409
    finally:
        clean_up_listing(ids["listing_id"])


def test_concurrent_partial_approvals_split_the_remaining_exactly():
    """Two requests for 4 against 5 available allocate 4 then 1, never 8.

    The first approval takes its full 4, leaving 1. The second, forced to wait by
    the lock, reads the lowered remaining of 1 and partial-fills to 1. The total
    is exactly 5, the stock, with nothing over-allocated.
    """
    ids = insert_committed_listing_with_two_claims(
        remaining_quantity=5, quantity_a=4, quantity_b=4
    )
    try:
        run_two_approvals(ids["poster_id"], ids["claim_a_id"], ids["claim_b_id"])

        approved_total = total_approved_quantity(ids["listing_id"])
        assert approved_total == 5
        assert remaining_quantity(ids["listing_id"]) == 0
    finally:
        clean_up_listing(ids["listing_id"])


def test_concurrent_double_approval_of_same_claim_allocates_once():
    """Approving the SAME claim twice at once (a double-click) allocates once.

    Both threads target the one claim. The claim row lock lets one approval move
    it to approved; the other waits, then sees it is no longer pending and is
    refused. The listing drops by the requested amount exactly once.
    """
    ids = insert_committed_listing_with_two_claims(
        remaining_quantity=10, quantity_a=3, quantity_b=3
    )
    try:
        # Point both threads at the same claim (claim A).
        results = run_two_approvals(
            ids["poster_id"], ids["claim_a_id"], ids["claim_a_id"]
        )

        approved_total = total_approved_quantity(ids["listing_id"])
        # Only claim A's single allocation of 3 lands; claim B is untouched.
        assert approved_total == 3
        assert remaining_quantity(ids["listing_id"]) == 7

        outcomes = []
        outcomes.append(results["a"][0])
        outcomes.append(results["b"][0])
        assert outcomes.count("ok") == 1
        assert outcomes.count("error") == 1
        for key in results:
            if results[key][0] == "error":
                assert results[key][1] == 409
    finally:
        clean_up_listing(ids["listing_id"])


# --- the request scenario: two people ask for everything at once ------------


def test_concurrent_requests_for_all_quantity_both_succeed():
    """Two members requesting all the available quantity at once both succeed.

    A request does not reserve stock, so there is nothing to race on: both join
    the queue and the listing's remaining quantity is untouched. No one is
    rejected at request time; the winner is decided later, at approval.
    """
    ids = insert_committed_listing_and_two_claimants(remaining_quantity=5)
    try:
        results = run_two_requests(
            ids["listing_id"], ids["claimant_a_id"], ids["claimant_b_id"], quantity=5
        )

        # Both requests were accepted.
        assert results["a"][0] == "ok"
        assert results["b"][0] == "ok"

        # Two pending claims now sit in the queue, each for the full amount.
        assert len(pending_claim_ids(ids["listing_id"])) == 2

        # Requesting reserved nothing, so the remaining quantity is unchanged.
        assert remaining_quantity(ids["listing_id"]) == 5
    finally:
        clean_up_listing(ids["listing_id"])
        clean_up_members_by_id([ids["claimant_a_id"], ids["claimant_b_id"], ids["poster_id"]])


def test_two_full_requests_then_approvals_allocate_exactly_the_stock():
    """The whole story: both request all 5, then both are approved.

    Requesting is non-exclusive, so both get into the queue. At approval the
    listing lock makes sure only the 5 in stock are handed out: one approval
    takes all 5 and the other is refused, so the total approved is exactly 5 and
    nothing is over-allocated.
    """
    ids = insert_committed_listing_and_two_claimants(remaining_quantity=5)
    try:
        # Both members request the full 5 at the same time; both succeed.
        request_results = run_two_requests(
            ids["listing_id"], ids["claimant_a_id"], ids["claimant_b_id"], quantity=5
        )
        assert request_results["a"][0] == "ok"
        assert request_results["b"][0] == "ok"

        # Now approve both pending claims at the same time.
        claim_ids = pending_claim_ids(ids["listing_id"])
        assert len(claim_ids) == 2
        approve_results = run_two_approvals(ids["poster_id"], claim_ids[0], claim_ids[1])

        # Exactly the stock was allocated, never more, and one approval was
        # refused with a 409.
        assert total_approved_quantity(ids["listing_id"]) == 5
        assert remaining_quantity(ids["listing_id"]) == 0

        outcomes = []
        outcomes.append(approve_results["a"][0])
        outcomes.append(approve_results["b"][0])
        assert outcomes.count("ok") == 1
        assert outcomes.count("error") == 1
        for key in approve_results:
            if approve_results[key][0] == "error":
                assert approve_results[key][1] == 409
    finally:
        clean_up_listing(ids["listing_id"])
        clean_up_members_by_id([ids["claimant_a_id"], ids["claimant_b_id"], ids["poster_id"]])


def test_unique_member_stub_uses_a_real_uuid():
    # A tiny guard so the stub helper keeps returning a usable member object.
    member = make_active_member_stub(uuid.uuid4())
    assert member.status == "active"
