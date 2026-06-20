# Tests for the member profile endpoints.
# Run from the project root with: npm run test:backend
#
# The core tests pass Member objects straight to get_member_profile() and
# update_member_profile(), covering the logic without any HTTP layer.
# The route-layer tests check the passthrough and the 401 that get_current_member
# gives a request with no identity.

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.dependencies import get_current_member
from app.main import app
from app.models.member import Member, MemberProfile
from app.routers.members import get_member_profile, update_member_profile
from app.schemas.member import MemberProfileUpdate


def insert_member(session, name="Alice", email="alice@example.com", status="active"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        status=status,
    )
    session.add(member)
    session.flush()
    profile = MemberProfile(
        member_id=member.id,
        display_name=name,
        contact_preference="email",
        neighborhood="Manoa",
    )
    session.add(profile)
    session.commit()
    return member


# --- core: get own profile (Scenario 1, view path) ---


def test_get_member_profile_returns_member_data(db_session):
    member = insert_member(db_session)

    result = get_member_profile(member.id, db_session)

    assert result.id == str(member.id)
    assert result.name == "Alice"
    assert result.email == "alice@example.com"
    assert result.profile is not None
    assert result.profile.display_name == "Alice"
    assert result.profile.contact_preference == "email"
    assert result.profile.neighborhood == "Manoa"


def test_get_member_profile_unknown_id_returns_404(db_session):
    with pytest.raises(HTTPException) as raised_error:
        get_member_profile(uuid.uuid4(), db_session)

    assert raised_error.value.status_code == 404


def test_get_member_profile_database_error_returns_503(broken_session):
    with pytest.raises(HTTPException) as raised_error:
        get_member_profile(uuid.uuid4(), broken_session)

    assert raised_error.value.status_code == 503


# --- core: update own profile (Scenario 1, edit path) ---


def test_update_own_display_name(db_session):
    member = insert_member(db_session)
    payload = MemberProfileUpdate(display_name="Alicia")

    result = update_member_profile(member, member.id, payload, db_session)

    assert result.profile is not None
    assert result.profile.display_name == "Alicia"
    # Unchanged fields are left alone.
    assert result.profile.contact_preference == "email"
    assert result.profile.neighborhood == "Manoa"


def test_update_contact_preference(db_session):
    member = insert_member(db_session)
    payload = MemberProfileUpdate(contact_preference="message")

    result = update_member_profile(member, member.id, payload, db_session)

    assert result.profile is not None
    assert result.profile.contact_preference == "message"


def test_update_neighborhood(db_session):
    member = insert_member(db_session)
    payload = MemberProfileUpdate(neighborhood="Kaimuki")

    result = update_member_profile(member, member.id, payload, db_session)

    assert result.profile is not None
    assert result.profile.neighborhood == "Kaimuki"


def test_update_strips_whitespace_from_display_name(db_session):
    member = insert_member(db_session)
    payload = MemberProfileUpdate(display_name="  Bob  ")

    result = update_member_profile(member, member.id, payload, db_session)

    assert result.profile is not None
    assert result.profile.display_name == "Bob"


# --- core: validation errors (Scenario 2) ---


def test_blank_display_name_is_rejected(db_session):
    member = insert_member(db_session)
    payload = MemberProfileUpdate(display_name="   ")

    with pytest.raises(HTTPException) as raised_error:
        update_member_profile(member, member.id, payload, db_session)

    assert raised_error.value.status_code == 422
    assert "blank" in raised_error.value.detail.lower()


def test_invalid_contact_preference_is_rejected_by_schema():
    # Pydantic's Literal validator rejects the value before the route even runs,
    # so this check verifies the schema itself, not the router logic.
    with pytest.raises(ValidationError):
        MemberProfileUpdate(contact_preference="carrier_pigeon")


# --- core: authorization (Scenario 3) ---


def test_member_cannot_edit_another_members_profile(db_session):
    alice = insert_member(db_session, name="Alice", email="alice@example.com")
    bob = insert_member(db_session, name="Bob", email="bob@example.com")
    payload = MemberProfileUpdate(display_name="NotAlice")

    with pytest.raises(HTTPException) as raised_error:
        # Bob tries to patch Alice's profile.
        update_member_profile(bob, alice.id, payload, db_session)

    assert raised_error.value.status_code == 403
    assert "own profile" in raised_error.value.detail.lower()


# --- core: database error path ---


def test_update_database_error_returns_503(broken_session):
    # The broken session is injected after the auth check passes, so we need a
    # member whose id we can pass to satisfy the acting_member == member_id check.
    member = Member(
        id=uuid.uuid4(),
        name="Test",
        email="test@example.com",
        password_hash="not-a-real-hash",
        status="active",
    )
    payload = MemberProfileUpdate(display_name="New Name")

    with pytest.raises(HTTPException) as raised_error:
        update_member_profile(member, member.id, payload, broken_session)

    assert raised_error.value.status_code == 503


# --- route identity: no X-Member-Id header returns 401 ---


def test_members_missing_header_returns_401(db_session):
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id=None, session=db_session)

    assert raised_error.value.status_code == 401


# --- route wiring ---


def test_get_member_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/api/members/" in route.path and "GET" in route.methods:
                found = True
    assert found


def test_patch_member_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/api/members/" in route.path and "PATCH" in route.methods:
                found = True
    assert found
