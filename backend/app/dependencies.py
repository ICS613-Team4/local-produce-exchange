# Shared identity check for the API. Every route that needs to know who is
# acting injects get_current_member. It reads the acting member's id from the
# X-Member-Id request header and loads that member. There is no secure session
# yet, so the header is the whole identity story for R1; it is insecure by
# design and every later story reuses it.
#
# This dependency only loads the member. It does not check the member's status.
# Each route applies its own status rule, so a route can return the status code
# that fits its own story (for example, the create-listing route returns 403
# for a non-active member).

import logging
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.models.member import Member

logger = logging.getLogger(__name__)


def get_current_member(
    x_member_id: Annotated[str | None, Header(alias="X-Member-Id")] = None,
    session: Session = Depends(get_db_session),
) -> Member:
    # The header is declared optional so FastAPI does not reject a missing
    # header with its own 422 before this function runs. We want our own 401
    # instead. A missing or blank header means we cannot tell who is acting.
    if x_member_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated. Missing X-Member-Id header.")
    member_id_text = x_member_id.strip()
    if member_id_text == "":
        raise HTTPException(status_code=401, detail="Not authenticated. Missing X-Member-Id header.")

    # member.id is a UUID column, so a value that is not a UUID cannot match any
    # member. Treat that as "not authenticated", not a server error.
    try:
        member_uuid = uuid.UUID(member_id_text)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=401, detail="Not authenticated. The X-Member-Id header is not a valid id.")

    # This lookup runs before the route body, so the route's own try/except
    # cannot catch a database failure here. Wrap it so a down or unmigrated
    # database returns 503 instead of an unhandled 500.
    try:
        member = session.get(Member, member_uuid)
    except Exception as error:
        logger.error("Looking up the current member failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read the member right now. "
                "Make sure the database is running and migrated: "
                "npm run db:up, then npm run db:migrate, then npm run db:seed."
            ),
        )

    if member is None:
        raise HTTPException(status_code=401, detail="Not authenticated. Unknown member.")

    return member
