# Response shape for the admin basic activity report (US-28).

from typing import Dict, Optional

from pydantic import BaseModel


class AdminReport(BaseModel):
    # Echoes the range the report was computed over. None means "all time"
    # for that end.
    start_date: Optional[str]
    end_date: Optional[str]
    generated_at: str

    # Every status the enum allows is always a key, zero-filled, so the
    # frontend can render a fixed set of rows without checking for missing
    # keys. Listings and requests are counted by when they were created,
    # inside the range; completed exchanges are counted by when they were
    # completed, which can differ from when they were requested.
    listings_by_status: Dict[str, int]
    total_listings: int
    requests_by_status: Dict[str, int]
    total_requests: int
    completed_exchanges: int
    members_by_status: Dict[str, int]
    total_members: int

    # Suspension activity (US-25/US-26), from suspension_record - distinct
    # from members_by_status, which is a snapshot of current status filtered
    # by join date. These count actions taken during the range: a member
    # suspended before the range and still suspended does not count here,
    # and one suspended inside the range but not yet reinstated counts as
    # suspended but not reinstated.
    members_suspended: int
    members_reinstated: int
