# Unit tests for the seed script. These run against the shared Postgres test
# database from conftest.py. The seed makes its own session from
# seed.SessionLocal and commits, so to keep that commit inside the test's
# rollback, each test binds seed.SessionLocal to the test's shared connection
# with savepoint mode (the same trick the conftest session uses).

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import sessionmaker

from app import seed
from app.models.listing import Listing
from app.models.member import InviteToken, Member, MemberProfile
from app.models.sample_data import SampleData


def bind_seed_to_connection(db_connection, monkeypatch):
    # Bind the seed's sessions to the test's shared connection so the seed's own
    # commits land inside the test's savepoint and get rolled back in teardown,
    # not written to the real database.
    session_factory = sessionmaker(bind=db_connection, join_transaction_mode="create_savepoint")
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


def insert_old_demo_listings(session):
    seed.seed_members(session)

    bob = seed.find_member_by_email(session, "bob@example.com")
    carol = seed.find_member_by_email(session, "carol@example.com")

    window_start = datetime.now(timezone.utc)
    window_end = window_start + timedelta(days=2)
    pickup_window = Range(window_start, window_end, bounds="[)")

    lettuce = Listing(
        owner_id=bob.id,
        title="Fresh Manoa Lettuce",
        description="Crisp green lettuce, just picked this morning.",
        category="Vegetables",
        dietary_tags=["vegan", "vegetarian"],
        allergen_tags=[],
        total_quantity=6,
        remaining_quantity=6,
        pickup_window=pickup_window,
        status="active",
    )
    bananas = Listing(
        owner_id=carol.id,
        title="Apple Bananas",
        description="A big bunch of sweet apple bananas from the backyard.",
        category="Fruit",
        dietary_tags=["vegan"],
        allergen_tags=[],
        total_quantity=10,
        remaining_quantity=10,
        pickup_window=pickup_window,
        status="active",
    )
    session.add(lettuce)
    session.add(bananas)
    session.commit()


def test_seed_database_inserts_demo_rows(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    slugs = read_sample_slugs(session_factory)
    assert len(slugs) == 3
    assert "manoa-lettuce" in slugs
    assert "apple-bananas" in slugs
    assert "kahuku-corn" in slugs


def test_seed_database_inserts_all_groups(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    assert count_rows(session_factory, SampleData) == 3
    assert count_rows(session_factory, Member) == 4
    assert count_rows(session_factory, MemberProfile) == 4
    assert count_rows(session_factory, InviteToken) == 2
    assert count_rows(session_factory, Listing) == 8


def test_seed_database_inserts_listings_owned_by_members(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        listings = session.scalars(select(Listing)).all()
        assert len(listings) == 8
        for listing in listings:
            # Every demo listing is active, owned by a member, and starts with
            # its remaining quantity equal to the total.
            assert listing.owner_id is not None
            assert listing.status == "active"
            assert listing.remaining_quantity == listing.total_quantity
            assert listing.description is not None and listing.description != ""
    finally:
        session.close()


def test_seed_database_does_not_duplicate_rows(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()
    seed.seed_database()

    assert count_rows(session_factory, SampleData) == 3
    assert count_rows(session_factory, Member) == 4
    assert count_rows(session_factory, MemberProfile) == 4
    assert count_rows(session_factory, InviteToken) == 2
    assert count_rows(session_factory, Listing) == 8


def test_seed_restores_deleted_invite_tokens(db_connection, monkeypatch):
    # This is the production bug we are guarding against: a table that was
    # emptied (or added after the first seed) should get its rows back on
    # the next run, without disturbing the groups that are still present.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, InviteToken)
    assert count_rows(session_factory, InviteToken) == 0

    seed.seed_database()
    assert count_rows(session_factory, InviteToken) == 2
    # The groups that were never deleted are untouched, not duplicated.
    assert count_rows(session_factory, Member) == 4
    assert count_rows(session_factory, MemberProfile) == 4


def test_seed_restores_deleted_listings(db_connection, monkeypatch):
    # The listing group restores the same way: emptying it and re-running the
    # seed puts the demo listings back without touching the other groups.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, Listing)
    assert count_rows(session_factory, Listing) == 0

    seed.seed_database()
    assert count_rows(session_factory, Listing) == 8
    assert count_rows(session_factory, Member) == 4


def test_seed_listings_adds_missing_rows_when_old_demo_listings_exist(db_session):
    # This matches a teammate database from the US-15 branch: the first two
    # demo listings are already present, but the six US-07 listings are not.
    insert_old_demo_listings(db_session)

    seed.seed_listings(db_session)

    rows = db_session.scalars(select(Listing)).all()
    assert len(rows) == 8

    seed.seed_listings(db_session)
    rows = db_session.scalars(select(Listing)).all()
    assert len(rows) == 8


def test_seed_listings_skips_when_members_missing(db_session):
    # Called directly on a database with no members, seed_listings finds no
    # owner and skips rather than inserting a listing with a broken owner.
    seed.seed_listings(db_session)

    rows = db_session.scalars(select(Listing)).all()
    assert len(rows) == 0


def test_seed_restores_deleted_profiles(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, MemberProfile)
    assert count_rows(session_factory, MemberProfile) == 0

    seed.seed_database()
    assert count_rows(session_factory, MemberProfile) == 4
    assert count_rows(session_factory, Member) == 4
