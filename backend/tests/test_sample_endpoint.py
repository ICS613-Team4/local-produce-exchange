# Tests for the sample endpoint. Run from the project root with: npm run test:backend
# These call the function and the models directly. No HTTP is involved.
# The database tests take the shared Postgres session from conftest.py.

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.sample_data import SampleData
from app.routers.sample_endpoint import create_sample
from app.schemas.sample_endpoint import SampleRequest


def test_valid_payload_is_accepted(db_session):
    payload = SampleRequest(foo="bar", baz=1765432100)
    result = create_sample(payload, db_session)
    assert result.message == "Payload accepted"
    assert result.baz == 1765432100
    assert result.sample_data == []


def test_valid_payload_returns_stored_rows(db_session):
    db_session.add(
        SampleData(
            slug="manoa-lettuce",
            name="Manoa Lettuce",
            note="Crisp green lettuce.",
        )
    )
    db_session.commit()
    payload = SampleRequest(foo="bar", baz=1)
    result = create_sample(payload, db_session)
    assert len(result.sample_data) == 1
    assert result.sample_data[0].slug == "manoa-lettuce"
    assert result.sample_data[0].name == "Manoa Lettuce"


def test_database_error_returns_service_unavailable(broken_session):
    # The broken session raises on its first query, so the SELECT inside the
    # endpoint fails and the route returns 503.
    payload = SampleRequest(foo="bar", baz=1)
    with pytest.raises(HTTPException) as raised_error:
        create_sample(payload, broken_session)
    assert raised_error.value.status_code == 503
    assert "Could not read sample data" in raised_error.value.detail


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
