# The shapes of the create-invite request and response.

from pydantic import BaseModel


class CreateInviteRequest(BaseModel):
    # The id of the member creating the invite. There is no server session
    # yet, so the frontend reads this from localStorage and sends it here.
    member_id: str


class CreateInviteResponse(BaseModel):
    # The invite token row id is a UUID in the database. The router converts
    # it with str() so the response JSON carries a plain string.
    id: str
    # The plaintext token, returned this one time so the member can share it.
    # It is never stored; the database keeps only its hash.
    token: str
    status: str
    # Token expiry is not enforced in R1, so this is null for now. The same
    # note applies to the register route.
    expires_at: str | None = None
