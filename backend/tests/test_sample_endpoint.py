# Tests for the sample endpoint. Run from the project root with: npm run test:backend
# These call the function and the models directly. No HTTP is involved.

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.sample_data import SampleData
from app.routers.sample_endpoint import create_sample
from app.schemas.sample_endpoint import SampleRequest


def make_test_session():
    # A throwaway database that lives in memory for a single test.
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_valid_payload_is_accepted():
    session = make_test_session()
    try:
        payload = SampleRequest(foo="bar", baz=1765432100)
        result = create_sample(payload, session)
        assert result.message == "Payload accepted"
        assert result.baz == 1765432100
        assert result.sample_data == []
    finally:
        session.close()


def test_valid_payload_returns_stored_rows():
    session = make_test_session()
    try:
        session.add(
            SampleData(
                slug="manoa-lettuce",
                name="Manoa Lettuce",
                note="Crisp green lettuce.",
            )
        )
        session.commit()
        payload = SampleRequest(foo="bar", baz=1)
        result = create_sample(payload, session)
        assert len(result.sample_data) == 1
        assert result.sample_data[0].slug == "manoa-lettuce"
        assert result.sample_data[0].name == "Manoa Lettuce"
    finally:
        session.close()


def test_database_error_returns_service_unavailable():
    # No create_all here, so the sample_data table is missing on purpose
    # and the SELECT inside the endpoint fails.
    engine = create_engine("sqlite:///:memory:")
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    try:
        payload = SampleRequest(foo="bar", baz=1)
        with pytest.raises(HTTPException) as raised_error:
            create_sample(payload, session)
        assert raised_error.value.status_code == 503
        assert "Could not read sample data" in raised_error.value.detail
    finally:
        session.close()


def test_numeric_string_is_coerced_to_int():
    # Pydantic's safe coercion: digits inside a string become an int.
    payload = SampleRequest(foo="bar", baz="42")
    assert payload.baz == 42


def test_wrong_type_is_rejected():
    with pytest.raises(ValidationError):
        SampleRequest(foo="bar", baz="not-a-number")


def test_missing_field_is_rejected():
    with pytest.raises(ValidationError):
        SampleRequest(foo="bar")


def test_malformed_json_is_rejected():
    # model_validate_json applies the same JSON parse rule FastAPI uses
    # on a request body, so this mirrors the "Send malformed JSON" button.
    broken_text = "{\"foo\": \"bar\", \"baz\": 123"
    with pytest.raises(ValidationError):
        SampleRequest.model_validate_json(broken_text)
