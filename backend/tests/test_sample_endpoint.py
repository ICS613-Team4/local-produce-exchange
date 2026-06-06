# Tests for the sample endpoint. Run from the project root with: npm run test:backend
# These call the function and the models directly. No HTTP is involved.

import pytest
from pydantic import ValidationError

from app.routers.sample_endpoint import create_sample
from app.schemas.sample_endpoint import SampleRequest, SampleResponse


def test_valid_payload_is_accepted():
    payload = SampleRequest(foo="bar", baz=1765432100)
    result = create_sample(payload)
    assert result.message == "Payload accepted"
    assert result.baz == 1765432100


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


def test_response_dumps_to_expected_dict():
    response = SampleResponse(message="Payload accepted", baz=123)
    assert response.model_dump() == {"message": "Payload accepted", "baz": 123}
