# Unit tests for the seed script. These use SQLite as a small SQLAlchemy
# test database, so they do not need Docker or Postgres.

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import seed
from app.models.sample_data import SampleData


def set_sqlite_seed_database(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    session_factory = sessionmaker(bind=engine)
    monkeypatch.setattr(seed, "engine", engine)
    monkeypatch.setattr(seed, "SessionLocal", session_factory)
    return session_factory


def read_sample_slugs(session_factory):
    session = session_factory()
    try:
        rows = session.scalars(select(SampleData)).all()
        slugs = []
        for row in rows:
            slugs.append(row.slug)
        return slugs
    finally:
        session.close()


def test_seed_database_inserts_demo_rows(monkeypatch):
    session_factory = set_sqlite_seed_database(monkeypatch)
    seed.seed_database()

    slugs = read_sample_slugs(session_factory)
    assert len(slugs) == 3
    assert "manoa-lettuce" in slugs
    assert "apple-bananas" in slugs
    assert "kahuku-corn" in slugs


def test_seed_database_does_not_duplicate_rows(monkeypatch):
    session_factory = set_sqlite_seed_database(monkeypatch)
    seed.seed_database()
    seed.seed_database()

    slugs = read_sample_slugs(session_factory)
    assert len(slugs) == 3
