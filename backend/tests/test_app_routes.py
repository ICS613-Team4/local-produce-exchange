# Tests for FastAPI route registration.

from app.main import app


def route_exists(path: str, method: str) -> bool:
    for route in app.routes:
        if route.path == path:
            route_methods = route.methods
            if route_methods is not None and method in route_methods:
                return True
    return False


def test_health_route_is_registered_under_api_prefix():
    assert route_exists("/api/health", "GET")


def test_sample_endpoint_route_is_registered_under_api_prefix():
    assert route_exists("/api/sample-endpoint", "POST")
