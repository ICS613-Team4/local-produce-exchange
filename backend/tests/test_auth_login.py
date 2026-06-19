# Tests for the login and logout endpoints. Run from the project root with:
# npm run test:backend
# These call the route function directly with a session. No HTTP is involved.
# The database tests take the shared Postgres session from conftest.py.

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.member import Member
from app.routers.auth import login, logout
from app.schemas.auth import LoginRequest
from app.security import hash_password


def insert_member(session, email, password, status="active"):
    member = Member(
        name="Test User",
        email=email,
        password_hash=hash_password(password),
        status=status,
    )
    session.add(member)
    session.commit()
    return member


def make_login_request(email, password):
    return LoginRequest(email=email, password=password)


# --- happy path (Scenario 1) ---


def test_login_returns_member_info_for_valid_credentials(db_session):
    insert_member(db_session, "alice@example.com", "password123")
    payload = make_login_request("alice@example.com", "password123")

    response = login(payload, db_session)

    assert response.name == "Test User"
    assert response.email == "alice@example.com"
    assert response.status == "active"
    assert response.id is not None


def test_login_normalizes_email_case(db_session):
    insert_member(db_session, "alice@example.com", "password123")
    payload = make_login_request("Alice@Example.COM", "password123")

    response = login(payload, db_session)

    assert response.email == "alice@example.com"


def test_login_trims_email_whitespace(db_session):
    insert_member(db_session, "alice@example.com", "password123")
    payload = make_login_request("  alice@example.com  ", "password123")

    response = login(payload, db_session)

    assert response.email == "alice@example.com"


# --- wrong credentials (Scenario 2) ---


def test_login_rejects_wrong_password(db_session):
    insert_member(db_session, "alice@example.com", "password123")
    payload = make_login_request("alice@example.com", "wrongpassword")

    with pytest.raises(HTTPException) as raised_error:
        login(payload, db_session)

    assert raised_error.value.status_code == 401
    assert raised_error.value.detail == "Invalid email or password."


def test_login_rejects_unknown_email(db_session):
    payload = make_login_request("nobody@example.com", "password123")

    with pytest.raises(HTTPException) as raised_error:
        login(payload, db_session)

    assert raised_error.value.status_code == 401
    assert raised_error.value.detail == "Invalid email or password."


# --- suspended account (Scenario 3) ---


def test_login_rejects_suspended_account(db_session):
    insert_member(db_session, "suspended@example.com", "password123", status="suspended")
    payload = make_login_request("suspended@example.com", "password123")

    with pytest.raises(HTTPException) as raised_error:
        login(payload, db_session)

    assert raised_error.value.status_code == 403
    assert raised_error.value.detail == "Your account is suspended."


# --- schema validation ---


def test_login_schema_rejects_empty_email():
    with pytest.raises(ValidationError):
        make_login_request("", "password123")


def test_login_schema_rejects_empty_password():
    with pytest.raises(ValidationError):
        make_login_request("alice@example.com", "")


# --- database failure ---


def test_login_returns_503_when_database_is_broken(broken_session):
    # The broken session raises on the member lookup inside the endpoint.
    payload = make_login_request("alice@example.com", "password123")

    with pytest.raises(HTTPException) as raised_error:
        login(payload, broken_session)

    assert raised_error.value.status_code == 503


# --- logout ---


def test_logout_returns_logged_out_message():
    response = logout()

    assert response["detail"] == "Logged out."


# --- route wiring ---


def test_login_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/auth/login" and "POST" in route.methods:
                found = True
    assert found


def test_logout_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/auth/logout" and "POST" in route.methods:
                found = True
    assert found
