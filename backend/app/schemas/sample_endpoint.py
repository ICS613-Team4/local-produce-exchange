# The shapes of the sample endpoint request and response.

from pydantic import BaseModel


class SampleRequest(BaseModel):
    foo: str
    baz: int


class SampleDataItem(BaseModel):
    id: int
    slug: str
    name: str
    note: str


class SampleResponse(BaseModel):
    message: str
    baz: int
    sample_data: list[SampleDataItem]
