# Shared test setup for the backend. Every database test runs against a real
# Postgres test database, not SQLite. The ERD types the listing table uses
# (TEXT[], TSTZRANGE, and the listing_status enum) do not exist on SQLite, and
# registering the Listing model puts those types on the shared metadata, so the
# whole suite moved onto Postgres.
#
# How this file works, in three pieces:
#   1. It points the app at a dedicated test database (produce_exchange_test)
#      before anything from app is imported, so the app engine binds to it.
#   2. Once per test session it drops and recreates that database and runs the
#      real migrations against it, so the schema matches production exactly.
#   3. For each test it opens a connection with an outer transaction and hands
#      out a session that turns the tested code's commits into savepoints, so
#      every test rolls back to a clean slate with no cross-test leakage.

import os

# This line must run before any "from app import ..." below. app/db.py builds
# the engine at import time from POSTGRES_DB, so whatever is set when app.db is
# first imported is the database the whole run uses. Setting it here, at the top
# of the first file pytest imports, guarantees the test database even if the
# developer forgot to export it. CI also sets it through the job env.
os.environ["POSTGRES_DB"] = "produce_exchange_test"

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import URL, create_engine, text  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db import engine  # noqa: E402

TEST_DB_NAME = "produce_exchange_test"

# backend/tests/conftest.py -> parents[1] is backend/, which holds alembic.ini.
BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI_PATH = BACKEND_DIR / "alembic.ini"


def make_maintenance_engine():
    # A connection to the default "postgres" database, used only to drop and
    # create the test database. The app engine points at the test database,
    # which may not exist yet, so it cannot do this job. AUTOCOMMIT is required
    # because DROP DATABASE and CREATE DATABASE cannot run inside a transaction.
    user = os.environ.get("POSTGRES_USER", "produce")
    password = os.environ.get("POSTGRES_PASSWORD", "produce")
    port = os.environ.get("POSTGRES_PORT", "5432")
    maintenance_url = URL.create(
        drivername="postgresql+psycopg",
        username=user,
        password=password,
        host="127.0.0.1",
        port=int(port),
        database="postgres",
    )
    return create_engine(maintenance_url, isolation_level="AUTOCOMMIT")


@pytest.fixture(scope="session", autouse=True)
def build_test_schema():
    # Drop and recreate the test database from scratch, then migrate it. A
    # per-test rollback only undoes data, never DDL, so a leftover table or a
    # half-applied migration from an earlier failed run would survive. Dropping
    # the whole database clears every table, type, and index first.
    maintenance_engine = make_maintenance_engine()
    maintenance_connection = maintenance_engine.connect()
    try:
        # Close any stray connections to the test database so DROP can run.
        maintenance_connection.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :name AND pid <> pg_backend_pid()"
            ),
            {"name": TEST_DB_NAME},
        )
        maintenance_connection.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}"'))
        maintenance_connection.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    finally:
        maintenance_connection.close()
        maintenance_engine.dispose()

    # Run the real migrations, not Base.metadata.create_all. The member enums
    # are declared create_type=False, so create_all would not create those
    # Postgres types and would fail on the first enum column. The migrations
    # create the enums, every table, the GIN indexes, and the check constraints
    # exactly as production does, including the new listing migration.
    alembic_config = Config(str(ALEMBIC_INI_PATH))
    command.upgrade(alembic_config, "head")

    yield

    # Release the app engine's pooled connections at the end of the session.
    engine.dispose()


@pytest.fixture()
def db_connection():
    # One connection with an outer transaction. The session below runs inside
    # it, and the teardown rolls the whole thing back, which discards
    # everything the test did, committed or not. test_seed.py needs this
    # connection directly so the seed's own commits land inside the same
    # transaction; ordinary tests just take db_session.
    connection = engine.connect()
    outer_transaction = connection.begin()
    yield connection
    outer_transaction.rollback()
    connection.close()


@pytest.fixture()
def db_session(db_connection):
    # join_transaction_mode="create_savepoint" turns each session.commit() the
    # tested code runs into a savepoint release inside the outer transaction,
    # so the route's and seed's real commits still get rolled back in teardown.
    session_factory = sessionmaker(bind=db_connection, join_transaction_mode="create_savepoint")
    session = session_factory()
    yield session
    session.close()


class BrokenSession:
    # A stand-in session that fails on every database call. The routes turn a
    # database error into a 503, and once the schema exists the old "missing
    # table" trick no longer fails, so these tests inject a real failure
    # instead. The bookkeeping calls (add, rollback, close) are no-ops so the
    # route reaches its failing query or commit.
    def _fail(self, *args, **kwargs):
        raise OperationalError("statement", {}, Exception("database is down"))

    scalars = _fail
    execute = _fail
    get = _fail
    commit = _fail
    flush = _fail

    def add(self, *args, **kwargs):
        pass

    def rollback(self, *args, **kwargs):
        pass

    def close(self, *args, **kwargs):
        pass


@pytest.fixture()
def broken_session():
    return BrokenSession()
