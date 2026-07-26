# Real PostgreSQL concurrency tests for UC-24 admin listing transitions.
#
# Each worker uses its own SessionLocal connection. A third connection initially
# holds the listing row lock so competing workers reach the race window before
# they are released together.

import threading
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range

from app.db import SessionLocal
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.notification import Notification
from app.routers.admin_listings import (
    deactivate_listing_as_admin,
    reactivate_listing_as_admin,
)
from app.routers.claim import create_claim
from app.schemas.claim import CreateClaimPayload


def make_member_stub(member_id, name="Admin"):
    return Member(
        id=member_id,
        name=name,
        email="unused@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )


def insert_committed_listing(status):
    session = SessionLocal()
    try:
        owner = Member(
            name="Concurrency Owner",
            email="admin-listing-race-owner@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        admin_a = Member(
            name="Admin A",
            email="admin-listing-race-a@example.com",
            password_hash="not-a-real-hash",
            status="active",
            role="admin",
        )
        admin_b = Member(
            name="Admin B",
            email="admin-listing-race-b@example.com",
            password_hash="not-a-real-hash",
            status="active",
            role="admin",
        )
        claimant = Member(
            name="Claimant",
            email="admin-listing-race-claimant@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )
        session.add_all([owner, admin_a, admin_b, claimant])
        session.flush()
        listing = Listing(
            owner_id=owner.id,
            title="Concurrency Produce",
            description="Used only by transaction tests.",
            category="Vegetables",
            dietary_tags=[],
            allergen_tags=[],
            total_quantity=5,
            remaining_quantity=5,
            pickup_window=Range(
                datetime(2027, 7, 1, 9, 0, tzinfo=timezone.utc),
                datetime(2027, 7, 1, 11, 0, tzinfo=timezone.utc),
                bounds="[)",
            ),
            status=status,
        )
        session.add(listing)
        session.commit()
        return {
            "listing_id": listing.id,
            "owner_id": owner.id,
            "admin_a_id": admin_a.id,
            "admin_b_id": admin_b.id,
            "claimant_id": claimant.id,
        }
    finally:
        session.close()


def clean_up(ids):
    session = SessionLocal()
    try:
        claim_ids = session.scalars(
            select(Claim.id).where(Claim.listing_id == ids["listing_id"])
        ).all()
        if claim_ids:
            session.execute(delete(Notification).where(Notification.claim_id.in_(claim_ids)))
        session.execute(
            delete(Notification).where(
                Notification.member_id.in_(
                    [
                        ids["owner_id"],
                        ids["admin_a_id"],
                        ids["admin_b_id"],
                        ids["claimant_id"],
                    ]
                )
            )
        )
        session.execute(delete(Claim).where(Claim.listing_id == ids["listing_id"]))
        session.execute(delete(Listing).where(Listing.id == ids["listing_id"]))
        session.execute(
            delete(Member).where(
                Member.id.in_(
                    [
                        ids["owner_id"],
                        ids["admin_a_id"],
                        ids["admin_b_id"],
                        ids["claimant_id"],
                    ]
                )
            )
        )
        session.commit()
    finally:
        session.close()


def lock_listing(listing_id):
    blocker = SessionLocal()
    blocker.scalars(
        select(Listing).where(Listing.id == listing_id).with_for_update()
    ).first()
    return blocker


def run_transition_workers(ids, operation):
    results = {}
    reached_query = {"a": threading.Event(), "b": threading.Event()}

    def worker(key, admin_id):
        session = SessionLocal()
        original_scalars = session.scalars

        def observed_scalars(statement, *args, **kwargs):
            entity = statement.column_descriptions[0].get("entity")
            if entity is Listing:
                reached_query[key].set()
            return original_scalars(statement, *args, **kwargs)

        session.scalars = observed_scalars
        try:
            try:
                if operation is deactivate_listing_as_admin:
                    operation(
                        make_member_stub(admin_id),
                        ids["listing_id"],
                        session,
                    )
                else:
                    operation(ids["listing_id"], session)
                results[key] = ("ok", admin_id)
            except HTTPException as raised:
                results[key] = ("error", raised.status_code)
        finally:
            session.close()

    blocker = lock_listing(ids["listing_id"])
    thread_a = threading.Thread(target=worker, args=("a", ids["admin_a_id"]))
    thread_b = threading.Thread(target=worker, args=("b", ids["admin_b_id"]))
    thread_a.start()
    thread_b.start()
    try:
        assert reached_query["a"].wait(timeout=10)
        assert reached_query["b"].wait(timeout=10)
        time.sleep(0.15)
    finally:
        blocker.commit()
        blocker.close()
    thread_a.join(timeout=10)
    thread_b.join(timeout=10)
    assert not thread_a.is_alive()
    assert not thread_b.is_alive()
    return results


def test_concurrent_admin_reactivation_allows_exactly_one_success():
    ids = insert_committed_listing("deactivated")
    try:
        results = run_transition_workers(ids, reactivate_listing_as_admin)
        assert sorted(result[0] for result in results.values()) == ["error", "ok"]
        assert [result[1] for result in results.values() if result[0] == "error"] == [409]

        session = SessionLocal()
        try:
            listing = session.get(Listing, ids["listing_id"])
            assert listing.status == "active"
            assert listing.deactivated_by is None
        finally:
            session.close()
    finally:
        clean_up(ids)


def test_concurrent_admin_deactivation_allows_one_winner_and_keeps_attribution():
    ids = insert_committed_listing("active")
    try:
        results = run_transition_workers(ids, deactivate_listing_as_admin)
        assert sorted(result[0] for result in results.values()) == ["error", "ok"]
        assert [result[1] for result in results.values() if result[0] == "error"] == [409]
        winning_admin_id = [
            result[1] for result in results.values() if result[0] == "ok"
        ][0]

        session = SessionLocal()
        try:
            listing = session.get(Listing, ids["listing_id"])
            assert listing.status == "deactivated"
            assert listing.deactivated_by == winning_admin_id
        finally:
            session.close()
    finally:
        clean_up(ids)


def test_claim_creation_racing_admin_deactivation_leaves_no_pending_claim():
    ids = insert_committed_listing("active")
    blocker = lock_listing(ids["listing_id"])
    deactivation_reached_listing = threading.Event()
    results = {}

    def deactivate():
        session = SessionLocal()
        original_scalars = session.scalars

        def observed_scalars(statement, *args, **kwargs):
            entity = statement.column_descriptions[0].get("entity")
            if entity is Listing:
                deactivation_reached_listing.set()
            return original_scalars(statement, *args, **kwargs)

        session.scalars = observed_scalars
        try:
            try:
                deactivate_listing_as_admin(
                    make_member_stub(ids["admin_a_id"]),
                    ids["listing_id"],
                    session,
                )
                results["deactivate"] = "ok"
            except HTTPException as raised:
                results["deactivate"] = raised.status_code
        finally:
            session.close()

    def request_listing():
        session = SessionLocal()
        try:
            try:
                create_claim(
                    str(ids["listing_id"]),
                    CreateClaimPayload(quantity=1),
                    make_member_stub(ids["claimant_id"], name="Claimant"),
                    session,
                )
                results["claim"] = "ok"
            except HTTPException as raised:
                results["claim"] = raised.status_code
        finally:
            session.close()

    deactivation_thread = threading.Thread(target=deactivate)
    claim_thread = threading.Thread(target=request_listing)
    try:
        deactivation_thread.start()
        assert deactivation_reached_listing.wait(timeout=2)
        time.sleep(0.15)
        claim_thread.start()
        time.sleep(0.15)
        blocker.commit()
        blocker.close()
        deactivation_thread.join(timeout=3)
        claim_thread.join(timeout=3)
        assert not deactivation_thread.is_alive()
        assert not claim_thread.is_alive()

        session = SessionLocal()
        try:
            listing = session.get(Listing, ids["listing_id"])
            pending_count = len(
                session.scalars(
                    select(Claim).where(
                        Claim.listing_id == ids["listing_id"],
                        Claim.status == "requested",
                    )
                ).all()
            )
            assert listing.status == "deactivated"
            assert pending_count == 0
        finally:
            session.close()
    finally:
        if blocker.in_transaction():
            blocker.rollback()
            blocker.close()
        deactivation_thread.join(timeout=1)
        claim_thread.join(timeout=1)
        clean_up(ids)
