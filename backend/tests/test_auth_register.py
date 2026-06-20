# Tests for the registration endpoint. Run from the project root with:
# npm run test:backend
# These call the route function directly with a session. No HTTP is involved.
# The database tests take the shared Postgres session from conftest.py.

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.member import InviteToken, Member, MemberProfile
from app.routers.auth import register
from app.schemas.auth import RegisterRequest
from app.security import hash_invite_token

# The plaintext invite token most tests insert and then redeem.
KNOWN_TOKEN_PLAINTEXT = "known-test-token"


def insert_creator(session):
    # InviteToken.created_by is NOT NULL, so every token needs a member
    # who issued it.
    creator = Member(
        name="Token Creator",
        email="creator@example.com",
        password_hash="not-a-real-hash",
    )
    session.add(creator)
    session.flush()
    return creator


def insert_token(session, creator_id, plaintext, status):
    token = InviteToken(
        created_by=creator_id,
        token_hash=hash_invite_token(plaintext),
        status=status,
    )
    session.add(token)
    session.commit()
    return token


def insert_pending_token(session):
    # The setup most tests share: one creator member and one pending
    # token for the known plaintext.
    creator = insert_creator(session)
    insert_token(session, creator.id, KNOWN_TOKEN_PLAINTEXT, "pending")


def make_request(name, email, password, invite_token):
    return RegisterRequest(
        name=name,
        email=email,
        password=password,
        invite_token=invite_token,
    )


def count_members(session):
    rows = session.scalars(select(Member)).all()
    return len(rows)


def get_token_row(session):
    token_hash = hash_invite_token(KNOWN_TOKEN_PLAINTEXT)
    query = select(InviteToken).where(InviteToken.token_hash == token_hash)
    return session.scalars(query).first()


# --- happy path ---


def test_register_creates_member_profile_and_marks_token_used(db_session):
    insert_pending_token(db_session)
    payload = make_request(
        "New Person",
        "New.Person@Example.COM",
        "password123",
        KNOWN_TOKEN_PLAINTEXT,
    )

    response = register(payload, db_session)

    # The member row exists with a lowercased email and a hashed password.
    member_query = select(Member).where(Member.email == "new.person@example.com")
    new_member = db_session.scalars(member_query).first()
    assert new_member is not None
    assert new_member.name == "New Person"
    assert new_member.password_hash != "password123"

    # The profile row exists and carries the name as the display name.
    profile_query = select(MemberProfile).where(MemberProfile.member_id == new_member.id)
    profile = db_session.scalars(profile_query).first()
    assert profile is not None
    assert profile.display_name == "New Person"

    # The token is now used, stamped, and points at the new member.
    token_row = get_token_row(db_session)
    assert token_row.status == "used"
    assert token_row.used_at is not None
    assert token_row.used_by == new_member.id

    # The response carries the id as a string plus the normalized values.
    assert response.id == str(new_member.id)
    assert response.name == "New Person"
    assert response.email == "new.person@example.com"


def test_register_trims_name_email_and_token(db_session):
    insert_pending_token(db_session)
    payload = make_request(
        "  Padded Person  ",
        "  padded@example.com  ",
        "password123",
        "  " + KNOWN_TOKEN_PLAINTEXT + "  ",
    )

    response = register(payload, db_session)

    assert response.name == "Padded Person"
    assert response.email == "padded@example.com"
    token_row = get_token_row(db_session)
    assert token_row.status == "used"


# --- bad token (Scenario 2) ---


def test_register_rejects_an_unknown_token(db_session):
    insert_pending_token(db_session)
    payload = make_request("New Person", "new@example.com", "password123", "no-such-token")

    with pytest.raises(HTTPException) as raised_error:
        register(payload, db_session)

    assert raised_error.value.status_code == 400
    # Only the setup creator exists; no account was created.
    assert count_members(db_session) == 1
    token_row = get_token_row(db_session)
    assert token_row.status == "pending"


def test_register_rejects_an_already_used_token(db_session):
    creator = insert_creator(db_session)
    insert_token(db_session, creator.id, "used-token", "used")
    payload = make_request("New Person", "new@example.com", "password123", "used-token")

    with pytest.raises(HTTPException) as raised_error:
        register(payload, db_session)

    assert raised_error.value.status_code == 400
    assert count_members(db_session) == 1


# --- duplicate email ---


def test_register_rejects_a_duplicate_email(db_session):
    # The setup creator already owns creator@example.com.
    insert_pending_token(db_session)
    payload = make_request(
        "Copy Cat",
        "creator@example.com",
        "password123",
        KNOWN_TOKEN_PLAINTEXT,
    )

    with pytest.raises(HTTPException) as raised_error:
        register(payload, db_session)

    assert raised_error.value.status_code == 409
    assert count_members(db_session) == 1
    token_row = get_token_row(db_session)
    assert token_row.status == "pending"


def test_register_rejects_a_duplicate_email_with_different_casing(db_session):
    insert_pending_token(db_session)
    payload = make_request(
        "Copy Cat",
        "Creator@Example.com",
        "password123",
        KNOWN_TOKEN_PLAINTEXT,
    )

    with pytest.raises(HTTPException) as raised_error:
        register(payload, db_session)

    assert raised_error.value.status_code == 409
    assert count_members(db_session) == 1
    token_row = get_token_row(db_session)
    assert token_row.status == "pending"


def test_register_returns_409_when_the_email_insert_hits_the_unique_constraint(db_session, monkeypatch):
    # Two requests holding different tokens can race on the same email.
    # The route's email check cannot see the other request, so the unique
    # constraint on member.email fires at flush time. Forcing flush to
    # raise IntegrityError simulates losing that race.
    insert_pending_token(db_session)

    def fake_flush():
        raise IntegrityError(
            "INSERT INTO member",
            None,
            Exception("duplicate key value violates unique constraint"),
        )

    monkeypatch.setattr(db_session, "flush", fake_flush)
    payload = make_request("Racer", "racer@example.com", "password123", KNOWN_TOKEN_PLAINTEXT)

    with pytest.raises(HTTPException) as raised_error:
        register(payload, db_session)

    assert raised_error.value.status_code == 409

    # Restore the real flush before querying again, because the query
    # below would otherwise autoflush into the fake and raise again.
    monkeypatch.undo()
    token_row = get_token_row(db_session)
    assert token_row.status == "pending"


# --- bad details: schema validation (automatic 422) ---


def test_schema_rejects_an_empty_name():
    with pytest.raises(ValidationError):
        make_request("", "new@example.com", "password123", "token")


def test_schema_rejects_an_empty_email():
    with pytest.raises(ValidationError):
        make_request("New Person", "", "password123", "token")


def test_schema_rejects_an_empty_token():
    with pytest.raises(ValidationError):
        make_request("New Person", "new@example.com", "password123", "")


def test_schema_rejects_a_short_password():
    with pytest.raises(ValidationError):
        make_request("New Person", "new@example.com", "short", "token")


def test_schema_rejects_an_over_length_name():
    long_name = "a" * 101
    with pytest.raises(ValidationError):
        make_request(long_name, "new@example.com", "password123", "token")


def test_schema_rejects_an_over_length_email():
    long_email = ("a" * 250) + "@x.com"
    with pytest.raises(ValidationError):
        make_request("New Person", long_email, "password123", "token")


def test_schema_rejects_an_over_length_token():
    long_token = "a" * 256
    with pytest.raises(ValidationError):
        make_request("New Person", "new@example.com", "password123", long_token)


# --- bad details: route validation (explicit 422) ---


def assert_route_raises_422_and_token_stays_pending(session, payload):
    insert_pending_token(session)

    with pytest.raises(HTTPException) as raised_error:
        register(payload, session)

    assert raised_error.value.status_code == 422
    assert count_members(session) == 1
    token_row = get_token_row(session)
    assert token_row.status == "pending"


def test_route_rejects_a_whitespace_only_name(db_session):
    payload = make_request("   ", "new@example.com", "password123", KNOWN_TOKEN_PLAINTEXT)
    assert_route_raises_422_and_token_stays_pending(db_session, payload)


def test_route_rejects_a_whitespace_only_email(db_session):
    payload = make_request("New Person", "   ", "password123", KNOWN_TOKEN_PLAINTEXT)
    assert_route_raises_422_and_token_stays_pending(db_session, payload)


def test_route_rejects_a_whitespace_only_token(db_session):
    payload = make_request("New Person", "new@example.com", "password123", "   ")
    assert_route_raises_422_and_token_stays_pending(db_session, payload)


def test_route_rejects_an_email_without_an_at_sign(db_session):
    payload = make_request("New Person", "not-an-email", "password123", KNOWN_TOKEN_PLAINTEXT)
    assert_route_raises_422_and_token_stays_pending(db_session, payload)


def test_route_rejects_a_password_over_72_bytes(db_session):
    long_password = "a" * 80
    payload = make_request("New Person", "new@example.com", long_password, KNOWN_TOKEN_PLAINTEXT)
    assert_route_raises_422_and_token_stays_pending(db_session, payload)


# --- database failure ---


def test_register_returns_503_when_the_database_is_broken(broken_session):
    # The broken session raises on the token lookup inside the endpoint.
    payload = make_request("New Person", "new@example.com", "password123", "token")

    with pytest.raises(HTTPException) as raised_error:
        register(payload, broken_session)

    assert raised_error.value.status_code == 503


# --- route wiring ---


def test_register_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    from app.main import app

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/auth/register" and "POST" in route.methods:
                found = True
    assert found
