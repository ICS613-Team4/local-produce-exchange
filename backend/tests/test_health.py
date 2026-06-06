# Tests for the health endpoint.

from app.routers.health import read_health


def test_health_returns_ok():
    result = read_health()
    assert result.status == "ok"
