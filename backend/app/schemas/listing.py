# The shapes of the listing request and response.
#
# CreateListingRequest is the create body: two separate pickup times (start and
# end). The create route assembles them into the single pickup_window range the
# database stores. ListingResponse is shared by two routes: the create route
# hands those two validated request times back, while the GET-details route
# (US-07) fills them by reading the stored range back off the row.

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


class ListingPhotoRef(BaseModel):
    id: str
    content_type: str
    position: int


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
    # The create route fills these from the validated request values it already
    # holds; the GET-details route fills them from the stored pickup_window
    # range it reads back off the row.
    pickup_start: datetime
    pickup_end: datetime
    status: str
    created_at: datetime
    # Who deactivated the listing, as a string id, or None. It is set only when an
    # admin deactivated it (US-27); an owner deactivation leaves it None. The
    # my-listings page reads this to tell an admin takedown apart from an owner
    # one. The default keeps every existing construction site (create, browse,
    # get-details, edit) working without passing this field.
    deactivated_by: str | None = None
    # The owner's display name, so the detail page can show "Posted by <name>".
    # Only the GET-details route fills it; the default keeps every other
    # construction site (create, browse, my-listings, edit) working unchanged.
    owner_name: str = ""
    photos: list[ListingPhotoRef] = Field(default_factory=list)
    # The owner's reputation AS a listing owner (US-20): the average rating
    # across reviews where this owner was reviewed in the listing_owner role,
    # excluding reviews an admin disabled, plus how many reviews are behind it.
    # None with a 0 count means no reviews yet. The browse and GET-details
    # routes fill these; the defaults keep the other construction sites
    # working unchanged.
    owner_rating_average: float | None = None
    owner_rating_count: int = 0
