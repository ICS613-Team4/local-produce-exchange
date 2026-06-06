# The shape of the health check response.

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
