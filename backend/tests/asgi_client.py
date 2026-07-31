# A tiny GET client for the tests that must go through the whole app instead of
# calling a route function directly.
#
# Most backend tests call the route function with a session and a member, which
# skips FastAPI entirely. That is the right level for route logic, but it also
# skips query-parameter binding and validation, so it cannot show that a
# repeated ?dietary_tags= binds as a list, or that ?page=0 is rejected with a
# 422 before the route body runs. Those tests need a real request.
#
# This builds a minimal ASGI HTTP scope by hand and calls the app the way a
# server would, which avoids adding httpx as a dependency just for a handful of
# tests. The caller sets app.dependency_overrides for the auth and session
# dependencies first, so the request runs inside the test's own transaction.

import asyncio

from app.main import app


async def call_asgi_get_async(path_with_query):
    # One GET through the app, returning its status code and raw body.
    if "?" in path_with_query:
        raw_path, query_string = path_with_query.split("?", 1)
    else:
        raw_path = path_with_query
        query_string = ""

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": raw_path,
        "raw_path": raw_path.encode("utf-8"),
        "query_string": query_string.encode("utf-8"),
        "headers": [],
        "server": ("testserver", 80),
        "client": ("testclient", 12345),
    }

    received_messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        received_messages.append(message)

    await app(scope, receive, send)

    status_code = None
    body_bytes = b""
    for message in received_messages:
        if message["type"] == "http.response.start":
            status_code = message["status"]
        elif message["type"] == "http.response.body":
            body_bytes = body_bytes + message.get("body", b"")
    return status_code, body_bytes


def call_asgi_get(path_with_query):
    # The synchronous form the tests use, so a test body stays a plain function
    # with no asyncio.run of its own.
    return asyncio.run(call_asgi_get_async(path_with_query))
