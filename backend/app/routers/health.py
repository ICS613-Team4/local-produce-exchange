# The health check endpoint. The frontend calls it to confirm
# that the backend is running.

from fastapi import APIRouter

from app.schemas.health import HealthResponse

router = APIRouter()


@router.get("/health")
def read_health() -> HealthResponse:
    return HealthResponse(status="ok")
