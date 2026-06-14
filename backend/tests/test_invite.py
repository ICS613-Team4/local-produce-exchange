# Tests for the invite endpoint. Run from the project root with:
# npm run test:backend
#
# These call the functions directly with a session. No HTTP is involved.
# The core tests pass a Member object straight to create_invite(), so they
# cover the permission gate and the token creation without any HTTP layer.
# The route-layer tests call create_invite_endpoint() directly to cover the
# member-id lookup and the UUID parse that the core never sees.

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.member import InviteToken, Member
from app.routers.auth import register
from app.routers.invite import create_invite, create_invite_endpoint
from app.schemas.auth import RegisterRequest
from app.schemas.invite import CreateInviteRequest
from app.security import hash_invite_token


def make_test_session():
    # A throwaway database that lives in memory for a single test.
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


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


def test_active_member_creates_an_invite():
    session = make_test_session()
    try:
        member = insert_member(session, "active")

        response = create_invite(member, session)

        # The response carries a non-empty token and the pending status.
        assert response.token != ""
        assert response.status == "pending"
        assert response.id is not None
        assert response.expires_at is None

        # A matching row exists, owned by this member and still pending.
        token_query = select(InviteToken).where(InviteToken.created_by == member.id)
        token_row = session.scalars(token_query).first()
        assert token_row is not None
        assert token_row.created_by == member.id
        assert token_row.status == "pending"
    finally:
        session.close()


# --- core: only the hash is stored, never the plaintext ---


def test_only_the_hash_is_stored_not_the_plaintext():
    session = make_test_session()
    try:
        member = insert_member(session, "active")

        response = create_invite(member, session)

        token_query = select(InviteToken).where(InviteToken.created_by == member.id)
        token_row = session.scalars(token_query).first()

        # The stored value is the sha256 hash of the returned plaintext,
        # and it is not the plaintext itself.
        assert token_row.token_hash == hash_invite_token(response.token)
        assert token_row.token_hash != response.token
    finally:
        session.close()


# --- core: two calls give two different tokens ---


def test_two_calls_give_two_different_tokens():
    session = make_test_session()
    try:
        member = insert_member(session, "active")

        first_response = create_invite(member, session)
        second_response = create_invite(member, session)

        # The token is random, so two calls do not repeat.
        assert first_response.token != second_response.token
        assert count_invite_tokens(session) == 2
    finally:
        session.close()


# --- core: suspended member is denied (Scenario 3) ---


def test_suspended_member_is_denied():
    session = make_test_session()
    try:
        member = insert_member(session, "suspended")

        with pytest.raises(HTTPException) as raised_error:
            create_invite(member, session)

        assert raised_error.value.status_code == 403
        # No token row was created.
        assert count_invite_tokens(session) == 0
    finally:
        session.close()


# --- core: inactive member is denied ---
# This is the closest real analog to Scenario 2 under the "any active member
# may invite" policy: there is no separate "not allowed" state, so a
# non-active status is the only denial the gate can produce.


def test_inactive_member_is_denied():
    session = make_test_session()
    try:
        member = insert_member(session, "inactive")

        with pytest.raises(HTTPException) as raised_error:
            create_invite(member, session)

        assert raised_error.value.status_code == 403
        assert count_invite_tokens(session) == 0
    finally:
        session.close()


# --- core: database error path returns 503 ---


def test_database_error_returns_service_unavailable():
    # No create_all here, so the invite_token table is missing on purpose
    # and the commit inside create_invite fails. The member object only needs
    # an id and an active status; it is never read from the database.
    engine = create_engine("sqlite:///:memory:")
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    try:
        member = Member(
            id=uuid.uuid4(),
            name="Inviter",
            email="inviter@example.com",
            password_hash="not-a-real-hash",
            status="active",
        )

        with pytest.raises(HTTPException) as raised_error:
            create_invite(member, session)

        assert raised_error.value.status_code == 503
        assert "Could not create an invite" in raised_error.value.detail
    finally:
        session.close()


# --- core: a created token can be redeemed by the register route (US-01) ---


def test_invite_token_can_be_redeemed_by_register():
    session = make_test_session()
    try:
        inviter = insert_member(session, "active")

        response = create_invite(inviter, session)
        plaintext = response.token

        # A guest redeems the freshly minted token to register.
        register_payload = RegisterRequest(
            name="New Friend",
            email="friend@example.com",
            password="password123",
            invite_token=plaintext,
        )
        register(register_payload, session)

        # The token is now marked used, tying the two stories together.
        token_hash = hash_invite_token(plaintext)
        token_query = select(InviteToken).where(InviteToken.token_hash == token_hash)
        token_row = session.scalars(token_query).first()
        assert token_row.status == "used"
    finally:
        session.close()


# --- route: active member through the route (Scenario 1) ---


def test_route_active_member_creates_an_invite():
    session = make_test_session()
    try:
        active = insert_member(session, "active")
        payload = CreateInviteRequest(member_id=str(active.id))

        response = create_invite_endpoint(payload, session)

        assert response.token != ""
        assert response.status == "pending"

        token_query = select(InviteToken).where(InviteToken.created_by == active.id)
        token_row = session.scalars(token_query).first()
        assert token_row is not None
        assert token_row.status == "pending"
    finally:
        session.close()


# --- route: suspended member through the route (Scenario 3) ---


def test_route_suspended_member_is_denied():
    session = make_test_session()
    try:
        suspended = insert_member(session, "suspended")
        payload = CreateInviteRequest(member_id=str(suspended.id))

        with pytest.raises(HTTPException) as raised_error:
            create_invite_endpoint(payload, session)

        # The member resolves, so the 403 comes from the status gate, not
        # the lookup.
        assert raised_error.value.status_code == 403
        assert count_invite_tokens(session) == 0
    finally:
        session.close()


# --- route: unknown member id ---


def test_route_unknown_member_id_returns_404():
    session = make_test_session()
    try:
        # A well-formed UUID that is not in the database.
        missing_id = str(uuid.uuid4())
        payload = CreateInviteRequest(member_id=missing_id)

        with pytest.raises(HTTPException) as raised_error:
            create_invite_endpoint(payload, session)

        assert raised_error.value.status_code == 404
        assert count_invite_tokens(session) == 0
    finally:
        session.close()


# --- route: malformed member id ---


def test_route_malformed_member_id_returns_404():
    session = make_test_session()
    try:
        # Not a UUID at all. The parse guard turns this into a clean 404,
        # not a 500.
        payload = CreateInviteRequest(member_id="not-a-uuid")

        with pytest.raises(HTTPException) as raised_error:
            create_invite_endpoint(payload, session)

        assert raised_error.value.status_code == 404
        assert count_invite_tokens(session) == 0
    finally:
        session.close()


# --- route wiring ---


def test_invite_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/invites" and "POST" in route.methods:
                found = True
    assert found
