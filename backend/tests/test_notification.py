# Tests for US-22: view status notifications.
#
# Covers the two read endpoints (the list and the polled unread count), the
# create_notification helper, and all eight write triggers (the seven claim
# status changes plus the exchange thread message). Runs on the real Postgres
# test database through the db_session fixture, because the notification table
# uses gen_random_uuid() and now() server defaults.

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import OperationalError

from app.dependencies import get_current_member
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.notification import Notification
from app.models.thread import Message
from app.notifications import create_notification
from app.routers.claim import (
    approve_claim,
    cancel_approved_claim,
    complete_exchange,
    confirm_pickup,
    create_claim,
    deny_claim,
    withdraw_claim,
)
from app.routers.notification import (
    get_notifications,
    get_unread_count,
    mark_notification_read,
)
from app.routers.thread import send_message_to_thread
from app.schemas.claim import CreateClaimPayload
from app.schemas.thread import SendMessagePayload


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


def insert_listing(session, owner, remaining_quantity=10):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
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
    return listing


def insert_claim(session, listing, claimant, quantity=3, status="requested"):
    now = datetime.now(timezone.utc)
    approved_quantity = None
    approved_at = None
    picked_up_at = None

    if status == "approved" or status == "picked_up":
        approved_quantity = quantity
        approved_at = now - timedelta(minutes=20)
        # The live flow moves the approved quantity off the listing at approval
        # time, so mirror that here.
        listing.remaining_quantity = listing.remaining_quantity - quantity
    if status == "picked_up":
        picked_up_at = now - timedelta(minutes=10)

    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=now - timedelta(minutes=30),
        approved_at=approved_at,
        picked_up_at=picked_up_at,
    )
    session.add(claim)
    session.commit()
    return claim


def insert_notification(
    session,
    member_id,
    claim_id=None,
    kind="request_submitted",
    message="Something happened.",
    created_at=None,
    is_read=False,
    read_at=None,
):
    notification = Notification(
        member_id=member_id,
        claim_id=claim_id,
        kind=kind,
        message=message,
        is_read=is_read,
    )
    if created_at is not None:
        notification.created_at = created_at
    if read_at is not None:
        notification.read_at = read_at
    session.add(notification)
    session.commit()
    return notification


def get_notifications_for(session, member_id):
    rows = session.scalars(
        select(Notification).where(Notification.member_id == member_id)
    ).all()
    return rows


class FakeScalarResult:
    def __init__(self, value):
        self.value = value

    def first(self):
        return self.value


class ClaimThenListingErrorSession:
    # Answers the first query (the claim load) with the given claim, then
    # raises on the second query (the new listing load added by US-22), so the
    # listing-load 503 branch in confirm_pickup and withdraw_claim is covered.
    def __init__(self, claim, error):
        self.claim = claim
        self.error = error
        self.query_count = 0

    def scalars(self, statement):
        self.query_count = self.query_count + 1
        if self.query_count == 1:
            return FakeScalarResult(self.claim)
        raise self.error


class NotificationCommitErrorSession:
    # Answers the notification load, then raises on commit, so the commit 503
    # branch in mark_notification_read (US-23) is covered. rollback is a no-op
    # so the route reaches its HTTPException.
    def __init__(self, notification, error):
        self.notification = notification
        self.error = error

    def scalars(self, statement):
        return FakeScalarResult(self.notification)

    def commit(self):
        raise self.error

    def rollback(self):
        pass


# ── the list endpoint get_notifications ──────────────────────────────────────


def test_get_notifications_newest_first(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    base = datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc)
    insert_notification(
        db_session, member.id, message="oldest", created_at=base
    )
    insert_notification(
        db_session, member.id, message="middle", created_at=base + timedelta(minutes=5)
    )
    insert_notification(
        db_session, member.id, message="newest", created_at=base + timedelta(minutes=10)
    )

    result = get_notifications(member, db_session)

    assert len(result.notifications) == 3
    assert result.notifications[0].message == "newest"
    assert result.notifications[1].message == "middle"
    assert result.notifications[2].message == "oldest"


def test_get_notifications_breaks_created_at_ties_by_id_descending(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    same_time = datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc)
    first = insert_notification(
        db_session, member.id, message="one", created_at=same_time
    )
    second = insert_notification(
        db_session, member.id, message="two", created_at=same_time
    )

    result = get_notifications(member, db_session)

    expected_ids = [str(first.id), str(second.id)]
    expected_ids.sort(reverse=True)
    returned_ids = []
    for item in result.notifications:
        returned_ids.append(item.id)
    assert returned_ids == expected_ids


def test_get_notifications_carries_the_claim_id(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)
    insert_notification(db_session, claimant.id, claim_id=claim.id)

    result = get_notifications(claimant, db_session)

    assert len(result.notifications) == 1
    assert result.notifications[0].claim_id == str(claim.id)


def test_get_notifications_empty_list(db_session):
    member = insert_member(db_session, email="lonely@example.com", name="Lonely")

    result = get_notifications(member, db_session)

    assert result.notifications == []
    assert result.unread_count == 0


def test_get_notifications_unread_count_matches_unread_rows(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    insert_notification(db_session, member.id, message="a")
    insert_notification(db_session, member.id, message="b")
    insert_notification(db_session, member.id, message="c", is_read=True)

    result = get_notifications(member, db_session)

    assert len(result.notifications) == 3
    assert result.unread_count == 2


def test_get_notifications_returns_only_the_callers_own(db_session):
    member_a = insert_member(db_session, email="a@example.com", name="A")
    member_b = insert_member(db_session, email="b@example.com", name="B")
    insert_notification(db_session, member_a.id, message="for a")
    insert_notification(db_session, member_b.id, message="for b")
    insert_notification(db_session, member_b.id, message="also for b")

    result = get_notifications(member_a, db_session)

    assert len(result.notifications) == 1
    assert result.notifications[0].message == "for a"
    assert result.unread_count == 1


@pytest.mark.parametrize(
    ("member_status", "detail_text"),
    [
        ("suspended", "Your account is suspended"),
        ("inactive", "Your account is not active"),
    ],
)
def test_get_notifications_rejects_non_active_member(
    db_session,
    member_status,
    detail_text,
):
    member = insert_member(
        db_session,
        status=member_status,
        email=member_status + "@example.com",
        name="Blocked",
    )

    with pytest.raises(HTTPException) as raised:
        get_notifications(member, db_session)

    assert raised.value.status_code == 403
    assert detail_text in raised.value.detail


def test_get_notifications_returns_503_on_database_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Reader",
        email="reader@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        get_notifications(member, broken_session)

    assert raised.value.status_code == 503
    assert "Could not read your notifications" in raised.value.detail


# ── the polled count endpoint get_unread_count ───────────────────────────────


def test_get_unread_count_counts_only_unread(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    insert_notification(db_session, member.id, message="a")
    insert_notification(db_session, member.id, message="b")
    insert_notification(db_session, member.id, message="c", is_read=True)
    insert_notification(db_session, member.id, message="d", is_read=True)

    result = get_unread_count(Response(), member, db_session)

    assert result.unread_count == 2


def test_get_unread_count_zero_for_member_with_no_notifications(db_session):
    member = insert_member(db_session, email="lonely@example.com", name="Lonely")

    result = get_unread_count(Response(), member, db_session)

    assert result.unread_count == 0


def test_get_unread_count_zero_when_all_are_read(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    insert_notification(db_session, member.id, message="a", is_read=True)
    insert_notification(db_session, member.id, message="b", is_read=True)

    result = get_unread_count(Response(), member, db_session)

    assert result.unread_count == 0


def test_get_unread_count_counts_only_the_callers_own(db_session):
    member_a = insert_member(db_session, email="a@example.com", name="A")
    member_b = insert_member(db_session, email="b@example.com", name="B")
    insert_notification(db_session, member_a.id, message="for a")
    insert_notification(db_session, member_b.id, message="for b")
    insert_notification(db_session, member_b.id, message="also for b")

    result = get_unread_count(Response(), member_a, db_session)

    assert result.unread_count == 1


@pytest.mark.parametrize(
    ("member_status", "detail_text"),
    [
        ("suspended", "Your account is suspended"),
        ("inactive", "Your account is not active"),
    ],
)
def test_get_unread_count_rejects_non_active_member(
    db_session,
    member_status,
    detail_text,
):
    # This matters because the endpoint is polled: a suspended member's header
    # must not keep reading a count.
    member = insert_member(
        db_session,
        status=member_status,
        email=member_status + "@example.com",
        name="Blocked",
    )

    with pytest.raises(HTTPException) as raised:
        get_unread_count(Response(), member, db_session)

    assert raised.value.status_code == 403
    assert detail_text in raised.value.detail


def test_get_unread_count_rejects_anonymous_caller(db_session):
    # The shared get_current_member dependency guards the polled endpoint the
    # same way it guards every member endpoint: no header means 401 before the
    # route body runs. Asserted once here at the router level; the dependency's
    # own tests cover the blank, malformed, and unknown-id cases.
    with pytest.raises(HTTPException) as raised:
        get_current_member(None, db_session)

    assert raised.value.status_code == 401


def test_get_unread_count_returns_503_on_database_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Reader",
        email="reader@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        get_unread_count(Response(), member, broken_session)

    assert raised.value.status_code == 503


def test_get_unread_count_sets_cache_control_no_store(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    response = Response()

    get_unread_count(response, member, db_session)

    assert response.headers["Cache-Control"] == "no-store"


def test_notification_routes_are_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found_list = False
    found_count = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/notifications":
                if "GET" in route.methods:
                    found_list = True
            if route.path == "/api/notifications/unread-count":
                if "GET" in route.methods:
                    found_count = True
    assert found_list
    assert found_count


# ── the mark-read endpoint mark_notification_read (US-23) ────────────────────


def test_mark_notification_read_marks_an_unread_notification(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    notification = insert_notification(db_session, member.id, message="unread until now")

    result = mark_notification_read(str(notification.id), member, db_session)

    assert result.id == str(notification.id)
    assert result.is_read is True
    assert result.read_at is not None

    saved = db_session.scalars(
        select(Notification).where(Notification.id == notification.id)
    ).first()
    assert saved.is_read is True
    assert saved.read_at is not None


def test_mark_notification_read_already_read_is_idempotent(db_session):
    # Scenario 2: the repeat is accepted with no error and changes nothing,
    # including the stored read_at.
    member = insert_member(db_session, email="reader@example.com", name="Reader")
    original_read_at = datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc)
    notification = insert_notification(
        db_session,
        member.id,
        message="already read",
        is_read=True,
        read_at=original_read_at,
    )

    result = mark_notification_read(str(notification.id), member, db_session)

    assert result.is_read is True
    assert result.read_at == original_read_at

    saved = db_session.scalars(
        select(Notification).where(Notification.id == notification.id)
    ).first()
    assert saved.is_read is True
    assert saved.read_at == original_read_at


def test_mark_notification_read_rejects_a_non_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    intruder = insert_member(db_session, email="intruder@example.com", name="Intruder")
    notification = insert_notification(db_session, owner.id, message="for the owner")

    with pytest.raises(HTTPException) as raised:
        mark_notification_read(str(notification.id), intruder, db_session)

    assert raised.value.status_code == 403
    assert "your own notifications" in raised.value.detail

    # The refusal wrote nothing: the owner's notification is still unread.
    saved = db_session.scalars(
        select(Notification).where(Notification.id == notification.id)
    ).first()
    assert saved.is_read is False
    assert saved.read_at is None


@pytest.mark.parametrize(
    ("member_status", "detail_text"),
    [
        ("suspended", "Your account is suspended"),
        ("inactive", "Your account is not active"),
    ],
)
def test_mark_notification_read_rejects_non_active_member(
    db_session,
    member_status,
    detail_text,
):
    member = insert_member(
        db_session,
        status=member_status,
        email=member_status + "@example.com",
        name="Blocked",
    )

    # The gate fires before any load, so the id never matters here.
    with pytest.raises(HTTPException) as raised:
        mark_notification_read(str(uuid.uuid4()), member, db_session)

    assert raised.value.status_code == 403
    assert detail_text in raised.value.detail


def test_mark_notification_read_bad_id_is_404(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")

    with pytest.raises(HTTPException) as raised:
        mark_notification_read("not-a-uuid", member, db_session)

    assert raised.value.status_code == 404
    assert "Notification not found" in raised.value.detail


def test_mark_notification_read_missing_id_is_404(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")

    with pytest.raises(HTTPException) as raised:
        mark_notification_read(str(uuid.uuid4()), member, db_session)

    assert raised.value.status_code == 404
    assert "Notification not found" in raised.value.detail


def test_mark_notification_read_returns_503_on_database_error(broken_session):
    member = Member(
        id=uuid.uuid4(),
        name="Reader",
        email="reader@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        mark_notification_read(str(uuid.uuid4()), member, broken_session)

    assert raised.value.status_code == 503
    assert "Could not update the notification" in raised.value.detail


def test_mark_notification_read_returns_503_when_the_commit_fails():
    member_id = uuid.uuid4()
    member = Member(
        id=member_id,
        name="Reader",
        email="reader@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    notification = Notification(
        id=uuid.uuid4(),
        member_id=member_id,
        claim_id=None,
        kind="request_submitted",
        message="The commit will fail.",
        is_read=False,
    )
    error = OperationalError("statement", {}, Exception("database is down"))
    session = NotificationCommitErrorSession(notification, error)

    with pytest.raises(HTTPException) as raised:
        mark_notification_read(str(notification.id), member, session)

    assert raised.value.status_code == 503
    assert "Could not update the notification" in raised.value.detail


def test_mark_notification_read_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found_mark_read = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/notifications/{notification_id}/read":
                if "PATCH" in route.methods:
                    found_mark_read = True
    assert found_mark_read


# ── the helper create_notification ───────────────────────────────────────────


def test_create_notification_adds_a_row_with_the_given_fields(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant)

    create_notification(
        db_session,
        owner.id,
        claim.id,
        "request_submitted",
        "Claimant requested 3 of your listing 'Fresh Tomatoes'.",
    )
    db_session.commit()

    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    saved = rows[0]
    assert saved.member_id == owner.id
    assert saved.claim_id == claim.id
    assert saved.kind == "request_submitted"
    assert saved.message == "Claimant requested 3 of your listing 'Fresh Tomatoes'."
    assert saved.is_read is False
    assert saved.created_at is not None
    assert saved.read_at is None


def test_create_notification_does_not_commit_on_its_own(db_session):
    member = insert_member(db_session, email="reader@example.com", name="Reader")

    notification = create_notification(
        db_session,
        member.id,
        None,
        "request_submitted",
        "Pending until the caller commits.",
    )

    # The row is pending in the session, not yet committed, which shows the
    # helper leaves the commit to the calling route.
    assert notification in db_session.new


# ── the seven claim.py triggers ──────────────────────────────────────────────


def test_create_claim_notifies_the_listing_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    payload = CreateClaimPayload(quantity=2)

    response = create_claim(str(listing.id), payload, claimant, db_session)

    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    assert rows[0].kind == "request_submitted"
    assert str(rows[0].claim_id) == response.id
    assert "Claimant" in rows[0].message
    assert "Fresh Tomatoes" in rows[0].message


def test_approve_claim_notifies_the_claimant(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="requested")

    approve_claim(str(claim.id), owner, db_session)

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim.id)
    ).first()
    assert saved_claim.status == "approved"
    rows = get_notifications_for(db_session, claimant.id)
    assert len(rows) == 1
    assert rows[0].kind == "request_approved"
    assert rows[0].claim_id == claim.id
    assert "Fresh Tomatoes" in rows[0].message


def test_deny_claim_notifies_the_claimant(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="requested")

    deny_claim(str(claim.id), owner, db_session)

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim.id)
    ).first()
    assert saved_claim.status == "denied"
    rows = get_notifications_for(db_session, claimant.id)
    assert len(rows) == 1
    assert rows[0].kind == "request_denied"
    assert rows[0].claim_id == claim.id


def test_withdraw_claim_notifies_the_listing_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="requested")

    withdraw_claim(str(claim.id), claimant, db_session)

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim.id)
    ).first()
    assert saved_claim.status == "cancelled"
    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    assert rows[0].kind == "request_withdrawn"
    assert rows[0].claim_id == claim.id
    assert "Claimant" in rows[0].message


def test_confirm_pickup_notifies_the_listing_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")

    confirm_pickup(str(claim.id), claimant, db_session)

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim.id)
    ).first()
    assert saved_claim.status == "picked_up"
    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    assert rows[0].kind == "pickup_confirmed"
    assert rows[0].claim_id == claim.id
    assert "Mark the exchange complete" in rows[0].message


def test_complete_exchange_notifies_the_claimant(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="picked_up")

    complete_exchange(str(claim.id), owner, db_session)

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim.id)
    ).first()
    assert saved_claim.status == "completed"
    rows = get_notifications_for(db_session, claimant.id)
    assert len(rows) == 1
    assert rows[0].kind == "exchange_completed"
    assert rows[0].claim_id == claim.id
    # The message names who completed the exchange and prompts for a review.
    assert "marked complete by Owner" in rows[0].message
    assert "Leave Owner a review" in rows[0].message


def test_cancel_approved_claim_notifies_the_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")

    cancel_approved_claim(str(claim.id), claimant, db_session)

    saved_claim = db_session.scalars(
        select(Claim).where(Claim.id == claim.id)
    ).first()
    assert saved_claim.status == "cancelled"
    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    assert rows[0].kind == "request_cancelled"
    assert rows[0].claim_id == claim.id
    assert "Claimant" in rows[0].message

    # Only the owner hears about it; the claimant did the cancelling.
    assert len(get_notifications_for(db_session, claimant.id)) == 0


def test_withdraw_and_cancel_are_told_apart(db_session):
    # Both set the claim to cancelled and both notify the OWNER, but a pending
    # request is withdrawn (request_withdrawn) while an approved one is
    # cancelled (request_cancelled).
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    withdrawn_claim = insert_claim(db_session, listing, claimant, status="requested")
    cancelled_claim = insert_claim(
        db_session, listing, claimant, quantity=2, status="approved"
    )

    withdraw_claim(str(withdrawn_claim.id), claimant, db_session)
    cancel_approved_claim(str(cancelled_claim.id), claimant, db_session)

    owner_rows = get_notifications_for(db_session, owner.id)
    assert len(owner_rows) == 2
    kinds_by_claim = {}
    for row in owner_rows:
        kinds_by_claim[row.claim_id] = row.kind
    assert kinds_by_claim[withdrawn_claim.id] == "request_withdrawn"
    assert kinds_by_claim[cancelled_claim.id] == "request_cancelled"

    assert len(get_notifications_for(db_session, claimant.id)) == 0


def test_confirm_pickup_returns_503_when_listing_load_fails():
    claimant_id = uuid.uuid4()
    claim = Claim(
        id=uuid.uuid4(),
        listing_id=uuid.uuid4(),
        claimant_id=claimant_id,
        requested_quantity=1,
        approved_quantity=1,
        status="approved",
        requested_at=datetime.now(timezone.utc),
        approved_at=datetime.now(timezone.utc),
    )
    claimant = Member(
        id=claimant_id,
        name="Claimant",
        email="claimant@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    error = OperationalError("statement", {}, Exception("database is down"))
    session = ClaimThenListingErrorSession(claim, error)

    with pytest.raises(HTTPException) as raised:
        confirm_pickup(str(claim.id), claimant, session)

    assert raised.value.status_code == 503


def test_withdraw_claim_returns_503_when_listing_load_fails():
    claimant_id = uuid.uuid4()
    claim = Claim(
        id=uuid.uuid4(),
        listing_id=uuid.uuid4(),
        claimant_id=claimant_id,
        requested_quantity=1,
        status="requested",
        requested_at=datetime.now(timezone.utc),
    )
    claimant = Member(
        id=claimant_id,
        name="Claimant",
        email="claimant@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    error = OperationalError("statement", {}, Exception("database is down"))
    session = ClaimThenListingErrorSession(claim, error)

    with pytest.raises(HTTPException) as raised:
        withdraw_claim(str(claim.id), claimant, session)

    assert raised.value.status_code == 503


# ── the eighth trigger: exchange thread messages ─────────────────────────────


def test_claimant_sending_a_message_notifies_the_owner(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")
    payload = SendMessagePayload(body="See you at noon.")

    send_message_to_thread(claim.id, payload, claimant, db_session)

    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    assert rows[0].kind == "message_received"
    assert rows[0].claim_id == claim.id
    assert "Claimant" in rows[0].message
    assert "Fresh Tomatoes" in rows[0].message


def test_owner_sending_a_message_notifies_the_claimant(db_session):
    # This is the test that catches a reversed recipient.
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")
    payload = SendMessagePayload(body="It will be on the porch.")

    send_message_to_thread(claim.id, payload, owner, db_session)

    rows = get_notifications_for(db_session, claimant.id)
    assert len(rows) == 1
    assert rows[0].kind == "message_received"
    assert rows[0].claim_id == claim.id
    assert "Owner" in rows[0].message


def test_the_sender_never_notifies_themselves(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")

    send_message_to_thread(
        claim.id, SendMessagePayload(body="From the claimant."), claimant, db_session
    )
    send_message_to_thread(
        claim.id, SendMessagePayload(body="From the owner."), owner, db_session
    )

    owner_rows = get_notifications_for(db_session, owner.id)
    claimant_rows = get_notifications_for(db_session, claimant.id)
    assert len(owner_rows) == 1
    assert owner_rows[0].kind == "message_received"
    assert len(claimant_rows) == 1
    assert claimant_rows[0].kind == "message_received"


def test_the_message_body_is_not_copied_into_the_notification(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")
    distinctive_body = "The gate code is 4711, do not share it."
    payload = SendMessagePayload(body=distinctive_body)

    send_message_to_thread(claim.id, payload, claimant, db_session)

    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1
    assert distinctive_body not in rows[0].message
    assert "4711" not in rows[0].message


def test_message_and_notification_are_saved_in_the_same_transaction(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")
    payload = SendMessagePayload(body="Both rows or neither.")

    send_message_to_thread(claim.id, payload, claimant, db_session)

    saved_messages = db_session.scalars(
        select(Message).where(Message.sender_id == claimant.id)
    ).all()
    assert len(saved_messages) == 1
    rows = get_notifications_for(db_session, owner.id)
    assert len(rows) == 1


def test_a_non_party_is_rejected_and_writes_no_notification(db_session):
    owner = insert_member(db_session, email="owner@example.com", name="Owner")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    stranger = insert_member(db_session, email="stranger@example.com", name="Stranger")
    listing = insert_listing(db_session, owner)
    claim = insert_claim(db_session, listing, claimant, status="approved")
    payload = SendMessagePayload(body="I should not be here.")

    with pytest.raises(HTTPException) as raised:
        send_message_to_thread(claim.id, payload, stranger, db_session)

    assert raised.value.status_code == 403
    # None of the three people involved got a notification. Scoped to this
    # test's members so committed rows from other test files cannot interfere.
    assert get_notifications_for(db_session, owner.id) == []
    assert get_notifications_for(db_session, claimant.id) == []
    assert get_notifications_for(db_session, stranger.id) == []
