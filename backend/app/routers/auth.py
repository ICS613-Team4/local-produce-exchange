# Auth endpoints: registration, login, and logout. A guest redeems a pending
# invite token to create a member account. A registered member logs in with
# a member account. Pydantic validates the body shape first; this function
# then normalizes the values and applies its own checks before any write.
# Login verifies the credentials and returns the member info.
# Logout is a thin endpoint that returns 200.

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.models.member import InviteToken, Member, MemberProfile
from app.schemas.auth import LoginRequest, LoginResponse, RegisterRequest, RegisterResponse
from app.security import hash_invite_token, hash_password, verify_password

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/auth/register")
def register(
    payload: RegisterRequest,
    session: Session = Depends(get_db_session),
) -> RegisterResponse:
    # Normalize the inputs before any database work.
    name = payload.name.strip()
    email = payload.email.strip().lower()
    invite_token = payload.invite_token.strip()

    if name == "":
        raise HTTPException(status_code=422, detail="Name must not be blank.")
    if email == "":
        raise HTTPException(status_code=422, detail="Email must not be blank.")
    if invite_token == "":
        raise HTTPException(status_code=422, detail="Invite token must not be blank.")
    if "@" not in email:
        # A small shape check for R1: an email without an @ sign cannot be
        # real. Stricter checking is deferred on purpose.
        raise HTTPException(status_code=422, detail="Email must contain an @ sign.")
    password_byte_count = len(payload.password.encode("utf-8"))
    if password_byte_count > 72:
        raise HTTPException(status_code=422, detail="Password is too long (over 72 bytes).")

    # Hash the password before taking the token row lock below, so the
    # lock is held for less time.
    password_hash = hash_password(payload.password)
    token_hash = hash_invite_token(invite_token)

    try:
        # FOR UPDATE locks the token row, so two requests redeeming the
        # same token wait on each other in PostgreSQL and the loser sees
        # status "used".
        token_query = select(InviteToken).where(InviteToken.token_hash == token_hash).with_for_update()
        token_row = session.scalars(token_query).first()
        if token_row is None or token_row.status != "pending":
            # Covers a token that does not exist, was already used, or is
            # marked expired. Token expiry is not enforced in R1.
            raise HTTPException(status_code=400, detail="Invalid or already-used invite token.")

        email_query = select(Member).where(Member.email == email)
        existing_member = session.scalars(email_query).first()
        if existing_member is not None:
            raise HTTPException(status_code=409, detail="An account with that email already exists.")

        # Leave status and role unset so the database applies its own
        # defaults (active, member).
        new_member = Member(name=name, email=email, password_hash=password_hash)
        session.add(new_member)
        # flush sends the INSERT now so the generated member id is known.
        session.flush()

        new_profile = MemberProfile(member_id=new_member.id, display_name=name)
        session.add(new_profile)

        token_row.status = "used"
        token_row.used_at = datetime.now(timezone.utc)
        token_row.used_by = new_member.id

        session.commit()
    except HTTPException:
        # Undo the open transaction so a rejected request leaves the
        # invite token pending, then pass the same error on to FastAPI.
        session.rollback()
        raise
    except IntegrityError as error:
        # Two requests holding different tokens can race on the same
        # email. The email check above misses that, and the loser lands
        # here when the unique constraint on member.email fires. That
        # constraint is the only one this insert can break.
        session.rollback()
        logger.error("Registration hit a unique constraint: %s", error)
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    except Exception as error:
        session.rollback()
        logger.error("Registration failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not register right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    return RegisterResponse(
        id=str(new_member.id),
        name=name,
        email=email,
    )


@router.post("/auth/login")
def login(
    payload: LoginRequest,
    session: Session = Depends(get_db_session),
) -> LoginResponse:
    # Normalize the email before the lookup.
    email = payload.email.strip().lower()

    try:
        member_query = select(Member).where(Member.email == email)
        member = session.scalars(member_query).first()
    except Exception as error:
        logger.error("Login lookup failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not log in right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    if member is None:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not verify_password(payload.password, member.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if member.status == "suspended":
        raise HTTPException(status_code=403, detail="Your account is suspended.")

    return LoginResponse(
        id=str(member.id),
        name=member.name,
        email=member.email,
        status=member.status,
    )


@router.post("/auth/logout")
def logout() -> dict:
    # The frontend clears its own session state. This endpoint exists so
    # there is a clear API contract and so server-side session invalidation
    # can be added later without changing the frontend call.
    return {"detail": "Logged out."}
