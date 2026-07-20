# Tests for the admin member search and detail endpoints (US-29).
# Run from the project root with: npm run test:backend
#
# Like test_members.py, the core tests call search_members() and
# get_admin_member_detail() directly. The route-layer tests check the
# passthrough and require_admin's 403/401 behavior.

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.dependencies import get_current_member, require_admin
from app.main import app
from app.models.member import Member, MemberProfile
from app.routers.admin_members import (
    get_admin_member_detail,
    get_admin_member_endpoint,
    search_members,
    search_members_endpoint,
)


def insert_member(session, name="Alice", email="alice@example.com", role="member", status="active", suspended_at=None):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        role=role,
        status=status,
        suspended_at=suspended_at,
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


# --- core: search_members (Scenario 1, search path) ---


def test_search_members_matches_by_name(db_session):
    insert_member(db_session, name="Carol Chen", email="carol@example.com")
    insert_member(db_session, name="Dave Diaz", email="dave@example.com")

    results = search_members("Carol", db_session)

    assert len(results) == 1
    assert results[0].name == "Carol Chen"
    assert results[0].status == "active"


def test_search_members_matches_by_email(db_session):
    insert_member(db_session, name="Carol Chen", email="carol@example.com")

    results = search_members("carol@example.com", db_session)

    assert len(results) == 1
    assert results[0].email == "carol@example.com"


def test_search_members_is_case_insensitive(db_session):
    insert_member(db_session, name="Carol Chen", email="carol@example.com")

    results = search_members("CAROL", db_session)

    assert len(results) == 1


def test_search_members_matches_partial_text(db_session):
    insert_member(db_session, name="Carol Chen", email="carol@example.com")

    results = search_members("car", db_session)

    assert len(results) == 1


def test_search_members_returns_empty_list_for_no_matches(db_session):
    insert_member(db_session, name="Carol Chen", email="carol@example.com")

    results = search_members("nobody-with-this-name", db_session)

    assert results == []


def test_search_members_returns_empty_list_for_blank_query(db_session):
    insert_member(db_session, name="Carol Chen", email="carol@example.com")

    results = search_members("   ", db_session)

    assert results == []


def test_search_members_includes_account_status(db_session):
    # Scenario 1: results carry account status, so an admin can already see a
    # suspended account in the search results, not just after opening it.
    insert_member(db_session, name="Suspended Sam", email="sam@example.com", status="suspended")

    results = search_members("Sam", db_session)

    assert len(results) == 1
    assert results[0].status == "suspended"


def test_search_members_database_error_returns_503(broken_session):
    with pytest.raises(HTTPException) as raised_error:
        search_members("anything", broken_session)

    assert raised_error.value.status_code == 503


# --- core: get_admin_member_detail (Scenario 1, detail path) ---


def test_get_admin_member_detail_returns_full_account_details(db_session):
    member = insert_member(db_session, name="Carol Chen", email="carol@example.com", role="member")

    result = get_admin_member_detail(member.id, db_session)

    assert result.id == str(member.id)
    assert result.name == "Carol Chen"
    assert result.email == "carol@example.com"
    assert result.role == "member"
    assert result.status == "active"
    assert result.display_name == "Carol Chen"
    assert result.neighborhood == "Manoa"
    assert result.contact_preference == "email"


def test_get_admin_member_detail_unknown_id_returns_404(db_session):
    with pytest.raises(HTTPException) as raised_error:
        get_admin_member_detail(uuid.uuid4(), db_session)

    assert raised_error.value.status_code == 404


def test_get_admin_member_detail_shows_suspended_status(db_session):
    # Scenario 3: a suspended account's details show the suspended status.
    suspended_at = datetime(2026, 5, 1, tzinfo=timezone.utc)
    member = insert_member(
        db_session, name="Suspended Sam", email="sam@example.com", status="suspended", suspended_at=suspended_at
    )

    result = get_admin_member_detail(member.id, db_session)

    assert result.status == "suspended"
    assert result.suspended_at is not None


def test_get_admin_member_detail_active_account_has_no_suspended_at(db_session):
    member = insert_member(db_session)

    result = get_admin_member_detail(member.id, db_session)

    assert result.suspended_at is None


def test_get_admin_member_detail_member_without_profile(db_session):
    # A member row with no member_profile row still returns detail, with the
    # profile-derived fields blank rather than raising.
    member = Member(name="NoProfile", email="noprofile@example.com", password_hash="not-a-real-hash")
    db_session.add(member)
    db_session.commit()

    result = get_admin_member_detail(member.id, db_session)

    assert result.display_name is None
    assert result.neighborhood is None
    assert result.contact_preference is None


def test_get_admin_member_detail_database_error_returns_503(broken_session):
    with pytest.raises(HTTPException) as raised_error:
        get_admin_member_detail(uuid.uuid4(), broken_session)

    assert raised_error.value.status_code == 503


# --- require_admin (Scenario 4: non-admin denied) ---


def test_require_admin_allows_admin(db_session):
    admin = insert_member(db_session, name="Admin Alice", email="admin@example.com", role="admin")

    result = require_admin(current_member=admin)

    assert result.id == admin.id


def test_require_admin_denies_non_admin_member(db_session):
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")

    with pytest.raises(HTTPException) as raised_error:
        require_admin(current_member=member)

    assert raised_error.value.status_code == 403


def test_get_current_member_missing_header_returns_401_before_require_admin_runs(db_session):
    # require_admin takes current_member from Depends(get_current_member), so a
    # missing header never reaches the role check; it 401s one layer down.
    with pytest.raises(HTTPException) as raised_error:
        get_current_member(x_member_id=None, session=db_session)

    assert raised_error.value.status_code == 401


# --- route wiring ---


def test_search_members_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/admin/members" and "GET" in route.methods:
                found = True
    assert found


def test_get_admin_member_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if "/api/admin/members/" in route.path and "GET" in route.methods:
                found = True
    assert found


# --- route passthroughs ---


def test_search_members_endpoint_delegates_to_core(db_session):
    admin = insert_member(db_session, name="Admin Alice", email="admin@example.com", role="admin")
    insert_member(db_session, name="Carol Chen", email="carol@example.com")

    result = search_members_endpoint(q="Carol", current_member=admin, session=db_session)

    assert len(result) == 1
    assert result[0].name == "Carol Chen"


def test_get_admin_member_endpoint_delegates_to_core(db_session):
    admin = insert_member(db_session, name="Admin Alice", email="admin@example.com", role="admin")
    member = insert_member(db_session, name="Carol Chen", email="carol@example.com")

    result = get_admin_member_endpoint(member_id=member.id, current_member=admin, session=db_session)

    assert result.id == str(member.id)
    assert result.name == "Carol Chen"
