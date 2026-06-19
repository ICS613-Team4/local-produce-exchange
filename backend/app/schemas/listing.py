# The shapes of the create-listing request and response.
#
# The request takes two separate pickup times (start and end). The route
# assembles them into the single pickup_window range the database stores, and
# the response hands those same two validated times back.

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class CreateListingRequest(BaseModel):
    # title and description are required and must not be empty. The route also
    # trims them and rejects an all-spaces value the schema lets through.
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    # category is required by US-15. The schema keeps it a plain string; the
    # route trims it and rejects a blank value.
    category: str
    total_quantity: int
    # The two tag lists default to empty, so a listing with no tags is normal.
    # default_factory makes a fresh list each time, which avoids any shared
    # mutable-default surprise.
    dietary_tags: list[str] = Field(default_factory=list)
    allergen_tags: list[str] = Field(default_factory=list)
    pickup_start: datetime
    pickup_end: datetime

    @field_validator("pickup_start", "pickup_end")
    @classmethod
    def must_be_timezone_aware(cls, value):
        # A datetime-local value sent with no timezone offset parses as a naive
        # datetime, which would be written as the wrong instant. Reject it so
        # the client must send a real offset. A tzinfo can be attached yet
        # still report no offset, so check both conditions, not just tzinfo.
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Pickup times must include a timezone offset.")
        return value


class ListingResponse(BaseModel):
    # id and owner_id are UUIDs in the database. The route converts them with
    # str() so the response JSON carries plain strings, matching the auth
    # responses.
    id: str
    owner_id: str
    title: str
    description: str
    category: str
    total_quantity: int
    remaining_quantity: int
    dietary_tags: list[str]
    allergen_tags: list[str]
    # The route fills these from the validated request values it already holds,
    # not by reading the stored range back off the row.
    pickup_start: datetime
    pickup_end: datetime
    status: str
    created_at: datetime
