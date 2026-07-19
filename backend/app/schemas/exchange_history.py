# Pydantic shapes for the exchange-history endpoint (US-24).
#
# The dashboard's Exchange History section shows every exchange the member is
# part of, on either side: the requests they made on other members' listings
# (the recipient side) and the requests other members made on their listings
# (the poster side). The response groups the rows by claim status, and each row
# says which side the member is on, because the side decides which control the
# row gets (an approved row is a confirm-pickup row for the recipient only, and
# a picked-up row is a complete-exchange row for the poster only).

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# One exchange the member is part of. side is "recipient" when the member made
# the request, "poster" when the request is on one of their listings.
# other_party_name is the person on the other side: the listing owner for a
# recipient row, the claimant for a poster row. The timestamps mirror the claim
# columns so the page can show the time the row entered its current status.
class ExchangeHistoryItem(BaseModel):
    id: str
    listing_id: str
    listing_title: str
    side: str
    other_party_name: str
    requested_quantity: int
    approved_quantity: Optional[int] = None
    status: str
    requested_at: datetime
    approved_at: Optional[datetime] = None
    picked_up_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None


# The whole exchange history, grouped by claim status in lifecycle order. Every
# list can be empty; a member with no activity gets six empty lists.
class ExchangeHistoryResponse(BaseModel):
    requested: list[ExchangeHistoryItem]
    approved: list[ExchangeHistoryItem]
    picked_up: list[ExchangeHistoryItem]
    completed: list[ExchangeHistoryItem]
    cancelled: list[ExchangeHistoryItem]
    denied: list[ExchangeHistoryItem]
