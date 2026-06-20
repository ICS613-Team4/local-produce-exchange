# Request and response shapes for the member profile endpoints.

from typing import Literal, Optional

from pydantic import BaseModel, Field


class MemberProfileRead(BaseModel):
    display_name: Optional[str]
    contact_preference: Optional[str]
    neighborhood: Optional[str]


class MemberRead(BaseModel):
    id: str
    name: str
    email: str
    status: str
    role: str
    created_at: str
    profile: Optional[MemberProfileRead]


class MemberProfileUpdate(BaseModel):
    # Each field is optional so callers can send only what changed.
    # None means "leave unchanged"; a value means "update to this".
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    # Pydantic rejects any value not in the Literal set, so no extra check is needed.
    contact_preference: Optional[Literal["email", "message", "either"]] = None
    neighborhood: Optional[str] = Field(default=None, min_length=1, max_length=100)
