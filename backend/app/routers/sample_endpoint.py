# A sample endpoint. The frontend sends it a JSON body. Pydantic validates the
# body before this function runs. An invalid body gets an automatic 422 reply.
# A valid body also gets every row of the sample_data table in the response.

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.models.sample_data import SampleData
from app.schemas.sample_endpoint import SampleDataItem, SampleRequest, SampleResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/sample-endpoint")
def create_sample(
    payload: SampleRequest,
    session: Session = Depends(get_db_session),
) -> SampleResponse:
    sample_data_items = []

    try:
        rows = session.scalars(select(SampleData)).all()
        for row in rows:
            item = SampleDataItem(
                id=row.id,
                slug=row.slug,
                name=row.name,
                note=row.note,
            )
            sample_data_items.append(item)
    except Exception as error:
        # Any database problem, including a missing server or missing table,
        # lands here. Log it for the developer and return an HTTP error.
        # No rollback is needed because closing the session discards the
        # failed transaction.
        logger.error("Reading sample data failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not read sample data from the database. "
                "Make sure it is running: npm run db, then npm run db:seed."
            ),
        )

    return SampleResponse(
        message="Payload accepted",
        baz=payload.baz,
        sample_data=sample_data_items,
    )
