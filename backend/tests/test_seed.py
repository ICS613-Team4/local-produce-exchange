# Unit tests for the seed script. These use SQLite as a small SQLAlchemy
# test database, so they do not need Docker or Postgres.

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker

from app import seed
from app.models.base import Base
from app.models.member import InviteToken, Member, MemberProfile
from app.models.sample_data import SampleData


def set_sqlite_seed_database(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
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


def count_rows(session_factory, model):
    session = session_factory()
    try:
        rows = session.scalars(select(model)).all()
        return len(rows)
    finally:
        session.close()


def delete_all_rows(session_factory, model):
    session = session_factory()
    try:
        session.execute(delete(model))
        session.commit()
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


def test_seed_database_inserts_all_groups(monkeypatch):
    session_factory = set_sqlite_seed_database(monkeypatch)
    seed.seed_database()

    assert count_rows(session_factory, SampleData) == 3
    assert count_rows(session_factory, Member) == 4
    assert count_rows(session_factory, MemberProfile) == 4
    assert count_rows(session_factory, InviteToken) == 2


def test_seed_database_does_not_duplicate_rows(monkeypatch):
    session_factory = set_sqlite_seed_database(monkeypatch)
    seed.seed_database()
    seed.seed_database()

    assert count_rows(session_factory, SampleData) == 3
    assert count_rows(session_factory, Member) == 4
    assert count_rows(session_factory, MemberProfile) == 4
    assert count_rows(session_factory, InviteToken) == 2


def test_seed_restores_deleted_invite_tokens(monkeypatch):
    # This is the production bug we are guarding against: a table that was
    # emptied (or added after the first seed) should get its rows back on
    # the next run, without disturbing the groups that are still present.
    session_factory = set_sqlite_seed_database(monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, InviteToken)
    assert count_rows(session_factory, InviteToken) == 0

    seed.seed_database()
    assert count_rows(session_factory, InviteToken) == 2
    # The groups that were never deleted are untouched, not duplicated.
    assert count_rows(session_factory, Member) == 4
    assert count_rows(session_factory, MemberProfile) == 4


def test_seed_restores_deleted_profiles(monkeypatch):
    session_factory = set_sqlite_seed_database(monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, MemberProfile)
    assert count_rows(session_factory, MemberProfile) == 0

    seed.seed_database()
    assert count_rows(session_factory, MemberProfile) == 4
    assert count_rows(session_factory, Member) == 4
