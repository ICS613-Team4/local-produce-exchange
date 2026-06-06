# The shapes of the sample endpoint request and response.

from pydantic import BaseModel


class SampleRequest(BaseModel):
    foo: str
    baz: int


class SampleResponse(BaseModel):
    message: str
    baz: int
