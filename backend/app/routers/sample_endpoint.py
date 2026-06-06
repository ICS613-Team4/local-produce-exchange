# A sample endpoint. The frontend sends it a JSON body. Pydantic validates the
# body before this function runs. An invalid body gets an automatic 422 reply.

from fastapi import APIRouter

from app.schemas.sample_endpoint import SampleRequest, SampleResponse

router = APIRouter()


@router.post("/sample-endpoint")
def create_sample(payload: SampleRequest) -> SampleResponse:
    return SampleResponse(message="Payload accepted", baz=payload.baz)
