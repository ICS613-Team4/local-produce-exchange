# Unit tests for the database URL builder in app/db.py.
# These need no Docker and no Postgres.

from app import db

ENV_NAMES = [
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "POSTGRES_PORT",
]


def clear_database_env(monkeypatch):
    # A developer's real .env may have set these when app.db was imported,
    # so every test starts from a known-empty environment.
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_build_database_url_uses_defaults(monkeypatch):
    clear_database_env(monkeypatch)
    url = db.build_database_url()
    full_url = url.render_as_string(hide_password=False)
    assert full_url == "postgresql+psycopg://produce:produce@127.0.0.1:5432/produce_exchange"


def test_build_database_url_uses_postgres_values(monkeypatch):
    clear_database_env(monkeypatch)
    monkeypatch.setenv("POSTGRES_USER", "alice")
    monkeypatch.setenv("POSTGRES_PASSWORD", "wonder")
    monkeypatch.setenv("POSTGRES_DB", "rabbit_hole")
    monkeypatch.setenv("POSTGRES_PORT", "5433")
    url = db.build_database_url()
    full_url = url.render_as_string(hide_password=False)
    assert full_url == "postgresql+psycopg://alice:wonder@127.0.0.1:5433/rabbit_hole"
