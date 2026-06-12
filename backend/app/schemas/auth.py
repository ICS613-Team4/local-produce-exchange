# The shapes of the registration request and response.

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # 254 is the longest a real email address can be (RFC 5321), so a
    # longer value is malformed input.
    email: str = Field(min_length=1, max_length=254)
    # The 8-character floor is a project decision. The upper bound is the
    # separate 72-byte check in the router, which counts UTF-8 bytes.
    password: str = Field(min_length=8)
    invite_token: str = Field(min_length=1, max_length=255)


class RegisterResponse(BaseModel):
    # The member id is a UUID in the database. The router converts it with
    # str() so the response JSON carries a plain string.
    id: str
    name: str
    email: str
