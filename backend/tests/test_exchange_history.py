# Tests for the exchange-history endpoint (US-24). The endpoint returns every
# exchange the caller is part of, on either side, grouped by claim status, and
# each row carries the caller's side (recipient or poster).

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import Range

from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.routers.exchange_history import (
    build_exchange_history_items,
    get_exchange_history,
)


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


def insert_listing(session, owner, title="Fresh Tomatoes", remaining_quantity=10):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
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
    return listing.id


def insert_claim(
    session,
    listing_id,
    claimant,
    quantity=3,
    status="requested",
    minutes_ago=0,
):
    # minutes_ago shifts every timestamp back, so two claims of the same status
    # get distinct times and the newest-first order is testable.
    now = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    approved_quantity = None
    approved_at = None
    picked_up_at = None
    completed_at = None
    cancelled_at = None
    denied_at = None

    if status == "approved" or status == "picked_up" or status == "completed":
        approved_quantity = quantity
        approved_at = now - timedelta(minutes=20)
    if status == "picked_up" or status == "completed":
        picked_up_at = now - timedelta(minutes=10)
    if status == "completed":
        completed_at = now
    if status == "cancelled":
        cancelled_at = now
    if status == "denied":
        denied_at = now

    claim = Claim(
        listing_id=listing_id,
        claimant_id=claimant.id,
        requested_quantity=quantity,
        approved_quantity=approved_quantity,
        status=status,
        requested_at=now - timedelta(minutes=30),
        approved_at=approved_at,
        picked_up_at=picked_up_at,
        completed_at=completed_at,
        cancelled_at=cancelled_at,
        denied_at=denied_at,
    )
    session.add(claim)
    session.commit()
    return claim.id


def test_exchange_history_groups_both_sides_by_status(db_session):
    # The caller holds rows in several statuses on both sides at once: their
    # own requests on another member's listing, and other members' requests on
    # the caller's own listing. Each row must land in its status group.
    me = insert_member(db_session, email="me@example.com", name="Me Member")
    other = insert_member(db_session, email="other@example.com", name="Other Member")

    their_listing_id = insert_listing(db_session, other, title="Their Lemons")
    my_listing_id = insert_listing(db_session, me, title="My Basil")

    # Recipient side: my requests on their listing move through the lifecycle.
    my_requested_id = insert_claim(db_session, their_listing_id, me, status="requested")

    # Poster side: their requests on my listing, one per remaining status.
    their_approved_id = insert_claim(db_session, my_listing_id, other, status="approved")

    response = get_exchange_history(me, db_session)

    assert len(response.requested) == 1
    assert response.requested[0].id == str(my_requested_id)
    assert response.requested[0].side == "recipient"
    assert response.requested[0].listing_id == str(their_listing_id)
    assert response.requested[0].listing_title == "Their Lemons"
    assert response.requested[0].other_party_name == "Other Member"
    assert response.requested[0].status == "requested"
    assert response.requested[0].requested_quantity == 3

    assert len(response.approved) == 1
    assert response.approved[0].id == str(their_approved_id)
    assert response.approved[0].side == "poster"
    assert response.approved[0].listing_title == "My Basil"
    assert response.approved[0].other_party_name == "Other Member"
    assert response.approved[0].approved_quantity == 3
    assert response.approved[0].approved_at is not None

    assert response.picked_up == []
    assert response.completed == []
    assert response.cancelled == []
    assert response.denied == []


@pytest.mark.parametrize(
    "claim_status",
    ["picked_up", "completed", "cancelled", "denied"],
)
def test_exchange_history_covers_every_status_group(db_session, claim_status):
    # The remaining four statuses each land in their own group too, with the
    # matching timestamp set.
    me = insert_member(db_session, email="me@example.com", name="Me Member")
    other = insert_member(db_session, email="other@example.com", name="Other Member")
    their_listing_id = insert_listing(db_session, other, title="Their Lemons")
    claim_id = insert_claim(db_session, their_listing_id, me, status=claim_status)

    response = get_exchange_history(me, db_session)

    if claim_status == "picked_up":
        group = response.picked_up
        assert group[0].picked_up_at is not None
    elif claim_status == "completed":
        group = response.completed
        assert group[0].completed_at is not None
    elif claim_status == "cancelled":
        group = response.cancelled
        assert group[0].cancelled_at is not None
    else:
        group = response.denied
        assert group[0].denied_at is not None

    assert len(group) == 1
    assert group[0].id == str(claim_id)
    assert group[0].side == "recipient"


def test_exchange_history_reports_the_side_per_row_at_the_same_status(db_session):
    # A member can hold both sides at the same status. Two approved rows: one
    # where the caller is the claimant, one on the caller's own listing. Each
    # row must report its own side and its own other party.
    me = insert_member(db_session, email="me@example.com", name="Me Member")
    other = insert_member(db_session, email="other@example.com", name="Other Member")

    their_listing_id = insert_listing(db_session, other, title="Their Lemons")
    my_listing_id = insert_listing(db_session, me, title="My Basil")

    recipient_claim_id = insert_claim(
        db_session, their_listing_id, me, status="approved", minutes_ago=10
    )
    poster_claim_id = insert_claim(
        db_session, my_listing_id, other, status="approved", minutes_ago=0
    )

    response = get_exchange_history(me, db_session)

    assert len(response.approved) == 2
    sides_by_id = {}
    parties_by_id = {}
    for item in response.approved:
        sides_by_id[item.id] = item.side
        parties_by_id[item.id] = item.other_party_name
    assert sides_by_id[str(recipient_claim_id)] == "recipient"
    assert sides_by_id[str(poster_claim_id)] == "poster"
    assert parties_by_id[str(recipient_claim_id)] == "Other Member"
    assert parties_by_id[str(poster_claim_id)] == "Other Member"


def test_exchange_history_orders_each_group_newest_first(db_session):
    # Within a group, the newest row (by the time it entered that status)
    # comes first.
    me = insert_member(db_session, email="me@example.com", name="Me Member")
    other = insert_member(db_session, email="other@example.com", name="Other Member")
    listing_one_id = insert_listing(db_session, other, title="Their Lemons")
    listing_two_id = insert_listing(db_session, other, title="Their Basil")

    older_claim_id = insert_claim(
        db_session, listing_one_id, me, status="requested", minutes_ago=60
    )
    newer_claim_id = insert_claim(
        db_session, listing_two_id, me, status="requested", minutes_ago=5
    )

    response = get_exchange_history(me, db_session)

    assert len(response.requested) == 2
    assert response.requested[0].id == str(newer_claim_id)
    assert response.requested[1].id == str(older_claim_id)


def test_exchange_history_excludes_exchanges_of_other_members(db_session):
    # An exchange between two other members, on a listing the caller does not
    # own, never shows up in the caller's history.
    me = insert_member(db_session, email="me@example.com", name="Me Member")
    poster = insert_member(db_session, email="poster@example.com", name="Poster")
    claimant = insert_member(db_session, email="claimant@example.com", name="Claimant")
    listing_id = insert_listing(db_session, poster, title="Their Lemons")
    insert_claim(db_session, listing_id, claimant, status="requested")

    response = get_exchange_history(me, db_session)

    assert response.requested == []
    assert response.approved == []
    assert response.picked_up == []
    assert response.completed == []
    assert response.cancelled == []
    assert response.denied == []


def test_exchange_history_returns_empty_groups_for_no_activity(db_session):
    # Scenario 2: a member with no activity gets six empty groups, not an error.
    me = insert_member(db_session, email="me@example.com", name="Me Member")

    response = get_exchange_history(me, db_session)

    assert response.requested == []
    assert response.approved == []
    assert response.picked_up == []
    assert response.completed == []
    assert response.cancelled == []
    assert response.denied == []


@pytest.mark.parametrize(
    ("member_status", "detail_text"),
    [
        ("suspended", "Your account is suspended"),
        ("inactive", "Your account is not active"),
    ],
)
def test_exchange_history_rejects_non_active_member(
    db_session,
    member_status,
    detail_text,
):
    me = insert_member(
        db_session,
        status=member_status,
        email=member_status + "@example.com",
        name="Me Member",
    )

    with pytest.raises(HTTPException) as raised:
        get_exchange_history(me, db_session)

    assert raised.value.status_code == 403
    assert detail_text in raised.value.detail


def test_exchange_history_returns_503_on_database_error(broken_session):
    me = Member(
        id=uuid.uuid4(),
        name="Me Member",
        email="me@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised:
        get_exchange_history(me, broken_session)

    assert raised.value.status_code == 503


def test_build_items_skips_a_claim_with_a_missing_listing():
    # A transient claim with no listing loaded stands in for a row whose
    # listing is gone; the builder skips it instead of failing the response.
    member_id = uuid.uuid4()
    claim = Claim(
        id=uuid.uuid4(),
        listing_id=uuid.uuid4(),
        claimant_id=member_id,
        requested_quantity=1,
        status="requested",
        requested_at=datetime.now(timezone.utc),
    )

    items = build_exchange_history_items([claim], member_id)

    assert items == []


def test_build_items_uses_an_empty_name_when_the_other_party_is_missing():
    # A recipient row whose listing has no loaded owner, and a poster row whose
    # claim has no loaded claimant, both fall back to an empty name. Transient
    # objects leave the relationships unloaded, which stands in for the
    # missing rows.
    member_id = uuid.uuid4()
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        title="Ownerless Listing",
        description="A listing with no loaded owner.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status="active",
    )
    recipient_claim = Claim(
        id=uuid.uuid4(),
        listing_id=listing.id,
        claimant_id=member_id,
        requested_quantity=1,
        status="requested",
        requested_at=datetime.now(timezone.utc),
    )
    recipient_claim.listing = listing
    poster_claim = Claim(
        id=uuid.uuid4(),
        listing_id=listing.id,
        claimant_id=uuid.uuid4(),
        requested_quantity=1,
        status="requested",
        requested_at=datetime.now(timezone.utc),
    )
    poster_claim.listing = listing

    items = build_exchange_history_items([recipient_claim, poster_claim], member_id)

    assert len(items) == 2
    assert items[0].side == "recipient"
    assert items[0].other_party_name == ""
    assert items[1].side == "poster"
    assert items[1].other_party_name == ""


def test_exchange_history_route_is_wired():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/exchange-history":
                if "GET" in route.methods:
                    found = True
    assert found
