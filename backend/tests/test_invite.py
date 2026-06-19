# Tests for the invite endpoint. Run from the project root with:
# npm run test:backend
#
# The core tests pass a Member object straight to create_invite(), so they
# cover the permission gate and the token creation without any HTTP layer.
# The route now identifies the caller through the shared X-Member-Id header
# (get_current_member), so the route-layer tests check the passthrough plus the
# 401 the header path gives a request with no identity.
# The database tests take the shared Postgres session from conftest.py.

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.dependencies import get_current_member
from app.main import app
from app.models.member import InviteToken, Member
from app.routers.auth import register
from app.routers.invite import create_invite, create_invite_endpoint
from app.schemas.auth import RegisterRequest
from app.security import hash_invite_token


def insert_member(session, status):
    # The member who does the inviting. InviteToken.created_by is NOT NULL,
    # so every token needs a real member behind it.
    member = Member(
        name="Inviter",
        email="inviter@example.com",
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def count_invite_tokens(session):
    rows = session.scalars(select(InviteToken)).all()
    return len(rows)


# --- core: active member creates an invite (Scenario 1) ---


def test_active_member_creates_an_invite(db_session):
    member = insert_member(db_session, "active")

    response = create_invite(member, db_session)

    # The response carries a non-empty token and the pending status.
    assert response.token != ""
    assert response.status == "pending"
    assert response.id is not None
    assert response.expires_at is None

    # A matching row exists, owned by this member and still pending.
    token_query = select(InviteToken).where(InviteToken.created_by == member.id)
    token_row = db_session.scalars(token_query).first()
    assert token_row is not None
    assert token_row.created_by == member.id
    assert token_row.status == "pending"


# --- core: only the hash is stored, never the plaintext ---


def test_only_the_hash_is_stored_not_the_plaintext(db_session):
    member = insert_member(db_session, "active")

    response = create_invite(member, db_session)

    token_query = select(InviteToken).where(InviteToken.created_by == member.id)
    token_row = db_session.scalars(token_query).first()

    # The stored value is the sha256 hash of the returned plaintext,
    # and it is not the plaintext itself.
    assert token_row.token_hash == hash_invite_token(response.token)
    assert token_row.token_hash != response.token


# --- core: two calls give two different tokens ---


def test_two_calls_give_two_different_tokens(db_session):
    member = insert_member(db_session, "active")

    first_response = create_invite(member, db_session)
    second_response = create_invite(member, db_session)

    # The token is random, so two calls do not repeat.
    assert first_response.token != second_response.token
    assert count_invite_tokens(db_session) == 2


# --- core: suspended member is denied (Scenario 3) ---


def test_suspended_member_is_denied(db_session):
    member = insert_member(db_session, "suspended")

    with pytest.raises(HTTPException) as raised_error:
        create_invite(member, db_session)

    assert raised_error.value.status_code == 403
    # No token row was created.
    assert count_invite_tokens(db_session) == 0


# --- core: inactive member is denied ---


def test_inactive_member_is_denied(db_session):
    member = insert_member(db_session, "inactive")

    with pytest.raises(HTTPException) as raised_error:
        create_invite(member, db_session)

    assert raised_error.value.status_code == 403
    assert count_invite_tokens(db_session) == 0


# --- core: database error path returns 503 ---


def test_database_error_returns_service_unavailable(broken_session):
    # The broken session raises on commit inside create_invite. The member
    # object only needs an id and an active status; it is never read from the
    # database.
    member = Member(
        id=uuid.uuid4(),
        name="Inviter",
        email="inviter@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )

    with pytest.raises(HTTPException) as raised_error:
        create_invite(member, broken_session)

    assert raised_error.value.status_code == 503
    assert "Could not create an invite" in raised_error.value.detail


# --- core: a created token can be redeemed by the register route (US-01) ---


def test_invite_token_can_be_redeemed_by_register(db_session):
    inviter = insert_member(db_session, "active")

    response = create_invite(inviter, db_session)
    plaintext = response.token

    # A guest redeems the freshly minted token to register.
    register_payload = RegisterRequest(
        name="New Friend",
        email="friend@example.com",
        password="password123",
        invite_token=plaintext,
    )
    register(register_payload, db_session)

    # The token is now marked used, tying the two stories together.
    token_hash = hash_invite_token(plaintext)
    token_query = select(InviteToken).where(InviteToken.token_hash == token_hash)
    token_row = db_session.scalars(token_query).first()
    assert token_row.status == "used"


# --- route: active member through the route (Scenario 1) ---


def test_route_active_member_creates_an_invite(db_session):
    active = insert_member(db_session, "active")

    # The route now receives the loaded member from get_current_member, so a
    # direct call passes the member object straight in.
    response = create_invite_endpoint(active, db_session)

    assert response.token != ""
    assert response.status == "pending"

    token_query = select(InviteToken).where(InviteToken.created_by == active.id)
    token_row = db_session.scalars(token_query).first()
    assert token_row is not None
    assert token_row.status == "pending"


# --- route: suspended member through the route (Scenario 3) ---


def test_route_suspended_member_is_denied(db_session):
    suspended = insert_member(db_session, "suspended")

    with pytest.raises(HTTPException) as raised_error:
        create_invite_endpoint(suspended, db_session)

    # The 403 comes from the status gate in the core, not from the identity
    # lookup (the member was passed in directly).
    assert raised_error.value.status_code == 403
    assert count_invite_tokens(db_session) == 0


# --- route identity: a request with no identity is rejected with 401 ---


def test_invite_identity_missing_header_returns_401(db_session):
    # The invite route now resolves the caller through get_current_member (the
    # X-Member-Id header), so a request with no identity is a 401 where it used
    # to be a 404. The fuller header matrix lives in test_listing.py.
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id=None, session=db_session)
    assert raised_error.value.status_code == 401


# --- route wiring ---


def test_invite_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/invites" and "POST" in route.methods:
                found = True
    assert found
