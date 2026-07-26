from pydantic import BaseModel


class AdminListingSummary(BaseModel):
    id: str
    owner_id: str
    owner_name: str
    title: str
    status: str
    deactivated_by: str | None
