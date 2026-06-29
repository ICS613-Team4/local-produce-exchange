from datetime import datetime

from pydantic import BaseModel, Field

MESSAGE_MAX_LENGTH = 2000


class SendMessagePayload(BaseModel):
    body: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)


class MessageResponse(BaseModel):
    id: str
    thread_id: str
    sender_id: str
    sender_name: str
    body: str
    sent_at: datetime


class ThreadResponse(BaseModel):
    id: str
    claim_id: str
    created_at: datetime
    messages: list[MessageResponse]
