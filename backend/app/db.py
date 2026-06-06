# Database connection setup. Creates one engine for the whole app and
# hands out short-lived sessions to route functions that ask for one.

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE_PATH = REPO_ROOT / ".env"

# Load the optional root .env file. Docker Compose reads the same file on
# its own. A missing file is fine, and values already set in the real
# shell environment win over the file. utf-8-sig also accepts the byte
# order mark some Windows editors put at the start of the file.
load_dotenv(ENV_FILE_PATH, encoding="utf-8-sig")


def build_database_url():
    user = os.environ.get("POSTGRES_USER", "produce")
    password = os.environ.get("POSTGRES_PASSWORD", "produce")
    database_name = os.environ.get("POSTGRES_DB", "produce_exchange")
    port = os.environ.get("POSTGRES_PORT", "5432")

    # URL.create escapes special characters in every part, so any password
    # works. Gluing the URL together by hand would break on @ : / % #.
    return URL.create(
        drivername="postgresql+psycopg",
        username=user,
        password=password,
        host="127.0.0.1",
        port=int(port),
        database=database_name,
    )


DATABASE_URL = build_database_url()

# pool_pre_ping checks a connection is still alive before reusing it.
# connect_timeout keeps a failed connection attempt short, in seconds.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 2},
)

SessionLocal = sessionmaker(bind=engine)


def get_db_session():
    # FastAPI calls this for any route that depends on a database session.
    # The finally block closes the session even when the route errors.
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
