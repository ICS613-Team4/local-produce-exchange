# Invite endpoint: a logged-in, active member creates a new invite token and
# sees its plaintext once so they can share it. The token is the same kind a
# guest redeems during registration.
#
# The code is split into two parts on purpose:
#   - create_invite() is the pure core. It takes a Member object, checks the
#     account is active, makes the token, and saves it. The unit tests call
#     this directly, so they cover the rule and the write with no HTTP layer.
#   - create_invite_endpoint() is the thin HTTP route. The acting member
#     arrives through the shared get_current_member dependency (the X-Member-Id
#     header), the same identity path the listing route uses. The dependency
#     resolves the member (or returns 401), and the route hands it to the core.

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import get_current_member
from app.models.member import InviteToken, Member
from app.schemas.invite import CreateInviteResponse
from app.security import generate_invite_token, hash_invite_token

logger = logging.getLogger(__name__)

router = APIRouter()


def create_invite(acting_member, session: Session) -> CreateInviteResponse:
    # Permission gate. Only an active member may invite. A suspended account
    # gets a message naming the suspension; any other non-active status is
    # also denied. There is no admin-only rule in R1.
    if acting_member.status != "active":
        if acting_member.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail="Your account is suspended, so you cannot create invites.",
            )
        raise HTTPException(
            status_code=403,
            detail="Your account is not active, so you cannot create invites.",
        )

    # Make a fresh random token, then store only its hash. The plaintext is
    # returned to the caller this one time and never written to the database.
    plaintext = generate_invite_token()
    token_hash = hash_invite_token(plaintext)

    new_token = InviteToken(
        created_by=acting_member.id,
        token_hash=token_hash,
        status="pending",
    )

    try:
        session.add(new_token)
        session.commit()
    except Exception as error:
        # Any database problem lands here, including the all-but-impossible
        # case of two tokens hashing the same (the unique constraint would
        # raise, which is an Exception too). Roll back and ask the member to
        # try again; a retry mints a brand-new token.
        session.rollback()
        logger.error("Creating an invite failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not create an invite right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    return CreateInviteResponse(
        id=str(new_token.id),
        token=plaintext,
        status="pending",
        expires_at=None,
    )


@router.post("/invites", status_code=201)
def create_invite_endpoint(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_db_session),
) -> CreateInviteResponse:
    # The acting member now comes from the shared identity dependency, which
    # reads the X-Member-Id header. A missing, malformed, or unknown id becomes
    # a 401 there, so the route just hands the loaded member to the core.
    return create_invite(current_member, session)
