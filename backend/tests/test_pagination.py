# Tests for the shared paging module (US-33): the two size constants, the Page
# envelope, and the count and window helpers every paged route is built on.
# Run from the project root with:
# uv run --locked --all-groups --directory backend pytest tests/test_pagination.py -v

from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.models.listing import Listing
from app.models.member import Member
from app.pagination import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    Page,
    apply_page_window,
    count_matching_rows,
)


def insert_member(session, email="owner@example.com"):
    member = Member(
        name="Owner",
        email=email,
        password_hash="not-a-real-hash",
        status="active",
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner, title, created_at):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title=title,
        description="Ripe red tomatoes from the garden.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status="active",
        created_at=created_at,
    )
    session.add(listing)
    session.commit()
    return listing


def insert_numbered_listings(session, owner, count):
    for index in range(count):
        insert_listing(
            session,
            owner,
            "Item " + str(index).zfill(2),
            datetime(2026, 1, 1, 9, index, tzinfo=timezone.utc),
        )


def ordered_titles(session, statement):
    titles = []
    for row in session.scalars(statement).all():
        titles.append(row.title)
    return titles


# --- the shared numbers -------------------------------------------------------


def test_default_page_size_is_twelve():
    # One shared default across all four paged pages. The frontend keeps its own
    # copy in frontend/src/utils/pagination.ts, and the two must agree.
    assert DEFAULT_PAGE_SIZE == 12


def test_max_page_size_is_one_hundred():
    assert MAX_PAGE_SIZE == 100


# --- the envelope -------------------------------------------------------------


def test_page_envelope_carries_items_total_and_the_window():
    page = Page[str](items=["a", "b"], total=7, page=2, page_size=2)

    assert page.items == ["a", "b"]
    assert page.total == 7
    assert page.page == 2
    assert page.page_size == 2


def test_page_envelope_validates_its_item_type():
    # The envelope is typed, so a route cannot accidentally put the wrong shape in
    # items and have it reach the client.
    with pytest.raises(Exception):
        Page[int](items=["not-an-int"], total=1, page=1, page_size=12)


# --- counting -----------------------------------------------------------------


def test_count_matching_rows_counts_every_matching_row(db_session):
    owner = insert_member(db_session)
    insert_numbered_listings(db_session, owner, 5)

    statement = select(Listing).where(Listing.owner_id == owner.id)

    assert count_matching_rows(db_session, statement) == 5


def test_count_matching_rows_honors_the_statements_filters(db_session):
    owner = insert_member(db_session)
    other = insert_member(db_session, email="other@example.com")
    insert_numbered_listings(db_session, owner, 3)
    insert_numbered_listings(db_session, other, 4)

    statement = select(Listing).where(Listing.owner_id == other.id)

    assert count_matching_rows(db_session, statement) == 4


def test_count_matching_rows_ignores_the_ordering(db_session):
    # An ORDER BY on the statement must not break the count: the helper drops it
    # before wrapping the statement as a subquery.
    owner = insert_member(db_session)
    insert_numbered_listings(db_session, owner, 3)

    statement = (
        select(Listing)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )

    assert count_matching_rows(db_session, statement) == 3


def test_count_matching_rows_is_zero_when_nothing_matches(db_session):
    owner = insert_member(db_session)

    statement = select(Listing).where(Listing.owner_id == owner.id)

    assert count_matching_rows(db_session, statement) == 0


# --- windowing ----------------------------------------------------------------


def test_first_page_starts_at_the_first_row(db_session):
    owner = insert_member(db_session)
    insert_numbered_listings(db_session, owner, 5)
    statement = (
        select(Listing)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )

    windowed = apply_page_window(statement, 1, 2)

    assert ordered_titles(db_session, windowed) == ["Item 04", "Item 03"]


def test_later_pages_step_forward_by_one_page_size(db_session):
    owner = insert_member(db_session)
    insert_numbered_listings(db_session, owner, 5)
    statement = (
        select(Listing)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )

    assert ordered_titles(db_session, apply_page_window(statement, 2, 2)) == ["Item 02", "Item 01"]
    assert ordered_titles(db_session, apply_page_window(statement, 3, 2)) == ["Item 00"]


def test_the_pages_together_cover_every_row_exactly_once(db_session):
    # No row may fall in two windows or in none, which is the whole point of
    # paging over a total order.
    owner = insert_member(db_session)
    insert_numbered_listings(db_session, owner, 7)
    statement = (
        select(Listing)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )

    seen = []
    for page_number in [1, 2, 3]:
        seen = seen + ordered_titles(db_session, apply_page_window(statement, page_number, 3))

    assert len(seen) == 7
    assert len(set(seen)) == 7


def test_a_window_past_the_end_returns_no_rows(db_session):
    owner = insert_member(db_session)
    insert_numbered_listings(db_session, owner, 3)
    statement = (
        select(Listing)
        .where(Listing.owner_id == owner.id)
        .order_by(Listing.created_at.desc(), Listing.id.desc())
    )

    # The helper does not clamp; the empty result is what tells the caller the
    # page it asked for is out of range.
    assert ordered_titles(db_session, apply_page_window(statement, 9, 12)) == []
