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
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.listing_photo import ListingPhoto
from app.models.member import InviteToken, Member, MemberProfile
from app.models.notification import Notification
from app.models.sample_data import SampleData
from app.routers.claim import cancel_approved_claim
from app.routers.listing_photo import MAX_PHOTO_BYTES


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
    assert count_rows(session_factory, Member) == 5
    assert count_rows(session_factory, MemberProfile) == 5
    assert count_rows(session_factory, InviteToken) == 2
    assert count_rows(session_factory, Listing) == 8
    assert count_rows(session_factory, ListingPhoto) == 8
    assert count_rows(session_factory, Claim) == 7
    assert count_rows(session_factory, Notification) == 15


def test_seed_database_inserts_demo_claims(db_connection, monkeypatch):
    # US-10 / US-11: the seed adds demo claims so the request-queue page, the
    # dashboard widget, and the detail control have visible content: three pending
    # requests plus two approved claims (used by the pickup-confirmation demo).
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        claims = session.scalars(select(Claim)).all()
        assert len(claims) == 7
        quantities = []
        listing_ids = set()
        pending_count = 0
        approved_count = 0
        completed_count = 0
        for claim in claims:
            # Every demo claim points at a listing and a claimant.
            assert claim.listing_id is not None
            assert claim.claimant_id is not None
            if claim.status == "requested":
                pending_count = pending_count + 1
                # A pending claim holds no approval record yet. A stale
                # approved_quantity here would read as a reservation the
                # listing quantities never accounted for.
                assert claim.approved_quantity is None
                assert claim.approved_at is None
                assert claim.picked_up_at is None
                assert claim.completed_at is None
            elif claim.status == "approved":
                approved_count = approved_count + 1
                # An approved claim must carry its approval record: the
                # cancel route returns approved_quantity to the listing, and
                # the request pages show the approval time.
                assert claim.approved_quantity is not None
                assert claim.approved_at is not None
                assert claim.requested_at < claim.approved_at
                assert claim.picked_up_at is None
                assert claim.completed_at is None
            elif claim.status == "completed":
                completed_count = completed_count + 1
                assert claim.approved_quantity is not None
                assert claim.approved_at is not None
                assert claim.picked_up_at is not None
                assert claim.completed_at is not None
                assert claim.requested_at < claim.approved_at
                assert claim.approved_at < claim.picked_up_at
                assert claim.picked_up_at < claim.completed_at
            quantities.append(claim.requested_quantity)
            listing_ids.add(claim.listing_id)
        quantities.sort()
        assert quantities == [1, 1, 2, 2, 3, 3, 3]
        # Three pending, two approved, and two completed demo claims.
        assert pending_count == 3
        assert approved_count == 2
        assert completed_count == 2
        assert len(listing_ids) == 5

        lettuce = session.scalars(
            select(Listing).where(Listing.title == "Fresh Manoa Lettuce")
        ).first()
        bananas = session.scalars(
            select(Listing).where(Listing.title == "Apple Bananas")
        ).first()
        thai_basil = session.scalars(
            select(Listing).where(Listing.title == "Thai Basil")
        ).first()
        lemons = session.scalars(
            select(Listing).where(Listing.title == "Backyard Meyer Lemons")
        ).first()
        # Completed exchanges keep their quantity off the listing, and approved
        # claims hold theirs reserved, so all four listings sit below total.
        assert lettuce.remaining_quantity == 4
        assert bananas.remaining_quantity == 7
        assert thai_basil.remaining_quantity == 9
        assert lemons.remaining_quantity == 23
    finally:
        session.close()


def test_seed_database_inserts_listings_owned_by_members(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        listings = session.scalars(select(Listing)).all()
        assert len(listings) == 8
        for listing in listings:
            # Every demo listing is active and owned by a member. The listings
            # with completed exchanges or approved claims reflect the amounts
            # those claims took or reserved; the rest start full.
            assert listing.owner_id is not None
            assert listing.status == "active"
            if listing.title == "Fresh Manoa Lettuce":
                assert listing.remaining_quantity == 4
            elif listing.title == "Apple Bananas":
                assert listing.remaining_quantity == 7
            elif listing.title == "Thai Basil":
                assert listing.remaining_quantity == 9
            elif listing.title == "Backyard Meyer Lemons":
                assert listing.remaining_quantity == 23
            else:
                assert listing.remaining_quantity == listing.total_quantity
            assert listing.description is not None and listing.description != ""
    finally:
        session.close()


def test_seed_database_does_not_duplicate_rows(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()
    seed.seed_database()

    assert count_rows(session_factory, SampleData) == 3
    assert count_rows(session_factory, Member) == 5
    assert count_rows(session_factory, MemberProfile) == 5
    assert count_rows(session_factory, InviteToken) == 2
    assert count_rows(session_factory, Listing) == 8
    assert count_rows(session_factory, ListingPhoto) == 8
    # The claim guard (table_is_empty on Claim) keeps the second run from adding
    # duplicate demo claims, and the notification guard works the same way.
    assert count_rows(session_factory, Claim) == 7
    assert count_rows(session_factory, Notification) == 15


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
    assert count_rows(session_factory, Member) == 5
    assert count_rows(session_factory, MemberProfile) == 5


def test_seed_restores_deleted_listings(db_connection, monkeypatch):
    # The listing group restores the same way: emptying it and re-running the
    # seed puts the demo listings back without touching the other groups. Claims
    # point at listings with no cascade delete, so the demo claims must be cleared
    # before the listings can be (and notifications point at claims, so they go
    # first of all), and re-seeding restores everything.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, Notification)
    delete_all_rows(session_factory, Claim)
    delete_all_rows(session_factory, ListingPhoto)
    delete_all_rows(session_factory, Listing)
    assert count_rows(session_factory, Listing) == 0
    assert count_rows(session_factory, Claim) == 0

    seed.seed_database()
    assert count_rows(session_factory, Listing) == 8
    assert count_rows(session_factory, ListingPhoto) == 8
    assert count_rows(session_factory, Claim) == 7
    assert count_rows(session_factory, Notification) == 15
    assert count_rows(session_factory, Member) == 5


def test_seed_restores_deleted_notifications(db_connection, monkeypatch):
    # Emptying only the notification table and re-running the seed puts the
    # demo notifications back, tied to the claims that are still present.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, Notification)
    assert count_rows(session_factory, Notification) == 0

    seed.seed_database()
    assert count_rows(session_factory, Notification) == 15
    assert count_rows(session_factory, Claim) == 7


def test_seed_listing_quantities_match_the_claims(db_connection, monkeypatch):
    # Cross-check the whole seeded data set: each listing's remaining quantity
    # must equal its total minus what its claims took. Approved and picked-up
    # claims hold their approved quantity reserved, completed claims keep it
    # for good, and pending, denied, and cancelled claims hold nothing. The
    # cancel route depends on this bookkeeping: it returns the approved
    # quantity to the listing, and the database rejects a remaining count
    # above the total.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        listings = session.scalars(select(Listing)).all()
        assert len(listings) == 8
        for listing in listings:
            claims = session.scalars(
                select(Claim).where(Claim.listing_id == listing.id)
            ).all()
            reserved = 0
            for claim in claims:
                if (
                    claim.status == "approved"
                    or claim.status == "picked_up"
                    or claim.status == "completed"
                ):
                    reserved = reserved + claim.approved_quantity
            assert listing.remaining_quantity == listing.total_quantity - reserved
    finally:
        session.close()


def test_cancelling_a_seeded_approved_claim_works(db_connection, monkeypatch):
    # The bug found in live QA: Alice cancels her own approved Thai Basil
    # request. The seed must have already moved Alice's 3 approved bunches
    # off the listing; otherwise returning them here pushes remaining past
    # total, the database check constraint rejects the update, and the whole
    # cancel fails with a 503.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        alice = seed.find_member_by_email(session, "alice@example.com")
        carol = seed.find_member_by_email(session, "carol@example.com")
        thai_basil = seed.find_listing_by_owner_and_title(session, carol, "Thai Basil")
        claim = seed.find_claim_by_listing_and_claimant(session, thai_basil, alice)
        assert claim.status == "approved"
        assert thai_basil.remaining_quantity == 9

        response = cancel_approved_claim(str(claim.id), alice, session)

        assert response.status == "cancelled"
        session.expire_all()
        listing_after = seed.find_listing_by_owner_and_title(session, carol, "Thai Basil")
        assert listing_after.remaining_quantity == 12
        # The cancel also notified Carol, the poster, like the live trigger does.
        cancel_notes = session.scalars(
            select(Notification)
            .where(Notification.member_id == carol.id)
            .where(Notification.kind == "request_cancelled")
        ).all()
        assert len(cancel_notes) == 1
        assert "Thai Basil" in cancel_notes[0].message
    finally:
        session.close()


def test_seed_restores_deleted_claims_without_double_deducting(db_connection, monkeypatch):
    # Emptying the claim table (notifications first, they point at claims) and
    # re-running the seed puts the demo claims back. The quantity deductions
    # are computed from total_quantity, so the surviving listings end at the
    # same numbers instead of losing the reserved amounts a second time.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, Notification)
    delete_all_rows(session_factory, Claim)
    assert count_rows(session_factory, Claim) == 0

    seed.seed_database()
    assert count_rows(session_factory, Claim) == 7

    session = session_factory()
    try:
        lettuce = session.scalars(
            select(Listing).where(Listing.title == "Fresh Manoa Lettuce")
        ).first()
        bananas = session.scalars(
            select(Listing).where(Listing.title == "Apple Bananas")
        ).first()
        thai_basil = session.scalars(
            select(Listing).where(Listing.title == "Thai Basil")
        ).first()
        lemons = session.scalars(
            select(Listing).where(Listing.title == "Backyard Meyer Lemons")
        ).first()
        assert lettuce.remaining_quantity == 4
        assert bananas.remaining_quantity == 7
        assert thai_basil.remaining_quantity == 9
        assert lemons.remaining_quantity == 23
    finally:
        session.close()


def test_seed_database_gives_every_member_notifications(db_connection, monkeypatch):
    # US-22 extension: every seed member has notifications waiting, so any demo
    # login shows the header bell badge and a populated notifications page.
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        members = session.scalars(select(Member)).all()
        # Alice, Bob, Carol, Dave, plus Erin (US-29: a standing suspended-account
        # fixture). Erin gets no notifications below: she is suspended from seed
        # time, so login already refuses her (auth.py), and this test's point is
        # that every member who *can* log in sees a populated notifications page.
        assert len(members) == 5
        counts_by_email = {}
        for member in members:
            notifications = session.scalars(
                select(Notification).where(Notification.member_id == member.id)
            ).all()
            counts_by_email[member.email] = len(notifications)
            for notification in notifications:
                assert notification.is_read is False
                assert notification.read_at is None

        assert counts_by_email["alice@example.com"] == 2
        assert counts_by_email["bob@example.com"] == 5
        assert counts_by_email["carol@example.com"] == 5
        assert counts_by_email["dave@example.com"] == 3
    finally:
        session.close()


def test_seed_notifications_match_their_source_claims(db_connection, monkeypatch):
    # Full data integrity: every seeded notification is consistent with the
    # seeded claim it points at. The recipient follows the trigger rules, the
    # timestamp equals the matching claim timestamp, and the message names the
    # claim's real listing title (and, for a submitted request, the claimant and
    # quantity).
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        notifications = session.scalars(select(Notification)).all()
        assert len(notifications) == 15
        for notification in notifications:
            assert notification.claim_id is not None
            claim = session.get(Claim, notification.claim_id)
            assert claim is not None
            listing = session.get(Listing, claim.listing_id)
            assert listing is not None
            claimant = session.get(Member, claim.claimant_id)
            assert claimant is not None

            if notification.kind == "request_submitted":
                assert notification.member_id == listing.owner_id
                assert notification.created_at == claim.requested_at
                expected_message = (
                    claimant.name
                    + " requested "
                    + str(claim.requested_quantity)
                    + " of your listing '"
                    + listing.title
                    + "'."
                )
                assert notification.message == expected_message
            elif notification.kind == "request_approved":
                assert notification.member_id == claim.claimant_id
                assert notification.created_at == claim.approved_at
                expected_message = (
                    "Your request for '" + listing.title + "' was approved."
                )
                assert notification.message == expected_message
            elif notification.kind == "pickup_confirmed":
                assert notification.member_id == listing.owner_id
                assert notification.created_at == claim.picked_up_at
                assert claimant.name in notification.message
                assert listing.title in notification.message
                assert "Mark the exchange complete" in notification.message
            elif notification.kind == "exchange_completed":
                assert notification.member_id == claim.claimant_id
                assert notification.created_at == claim.completed_at
                # The completer named in the message is the listing owner, the
                # only party who can complete an exchange.
                owner = session.get(Member, listing.owner_id)
                assert owner is not None
                expected_message = (
                    "Your exchange for '"
                    + listing.title
                    + "' was marked complete by "
                    + owner.name
                    + ". Leave "
                    + owner.name
                    + " a review."
                )
                assert notification.message == expected_message
            else:
                raise AssertionError(
                    "Unexpected seeded notification kind: " + notification.kind
                )
    finally:
        session.close()


def test_seed_notifications_skips_when_claims_missing(db_session):
    # With members and listings present but no demo claims, seed_notifications
    # has no source rows and skips rather than inserting a broken reference.
    seed.seed_members(db_session)
    seed.seed_listings(db_session)

    seed.seed_notifications(db_session)

    rows = db_session.scalars(select(Notification)).all()
    assert len(rows) == 0


def test_seed_notifications_skips_when_members_missing(db_session):
    # With no members at all, seed_notifications skips.
    seed.seed_notifications(db_session)

    rows = db_session.scalars(select(Notification)).all()
    assert len(rows) == 0


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


def test_seed_claims_skips_when_members_missing(db_session):
    # With no members, seed_claims finds no claimant and skips rather than
    # inserting a claim with a broken reference.
    seed.seed_claims(db_session)

    rows = db_session.scalars(select(Claim)).all()
    assert len(rows) == 0


def test_seed_claims_skips_when_listings_missing(db_session):
    # With members present but no demo listings, seed_claims finds no listing to
    # attach a claim to and skips.
    seed.seed_members(db_session)

    seed.seed_claims(db_session)

    rows = db_session.scalars(select(Claim)).all()
    assert len(rows) == 0


def test_seed_listing_photos_skips_when_members_missing(db_session):
    # Called directly on a database with no members, seed_listing_photos finds
    # no owner for any row and skips rather than failing.
    seed.seed_listing_photos(db_session)

    rows = db_session.scalars(select(ListingPhoto)).all()
    assert len(rows) == 0


def test_seed_listing_photos_skips_when_listings_missing(db_session):
    # With members present but no demo listings, every photo row finds no
    # listing and skips.
    seed.seed_members(db_session)

    seed.seed_listing_photos(db_session)

    rows = db_session.scalars(select(ListingPhoto)).all()
    assert len(rows) == 0


def test_seed_listing_photos_skips_a_missing_photo_file(db_session, monkeypatch):
    # A row that names a photo file that is not on disk is skipped with a
    # message instead of crashing the seed.
    seed.seed_members(db_session)
    seed.seed_listings(db_session)
    monkeypatch.setattr(
        seed,
        "_SEED_PHOTO_ROWS",
        [("bob@example.com", "Fresh Manoa Lettuce", "no-such-file.webp")],
    )

    seed.seed_listing_photos(db_session)

    rows = db_session.scalars(select(ListingPhoto)).all()
    assert len(rows) == 0


def test_seed_restores_deleted_profiles(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    delete_all_rows(session_factory, MemberProfile)
    assert count_rows(session_factory, MemberProfile) == 0

    seed.seed_database()
    assert count_rows(session_factory, MemberProfile) == 5
    assert count_rows(session_factory, Member) == 5


def test_seed_database_attaches_one_valid_photo_to_each_listing(
    db_connection,
    monkeypatch,
):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        listings = session.scalars(select(Listing)).all()
        photos = session.scalars(select(ListingPhoto)).all()
        assert len(listings) == 8
        assert len(photos) == 8

        for listing in listings:
            listing_photos = []
            for photo in photos:
                if photo.listing_id == listing.id:
                    listing_photos.append(photo)
            assert len(listing_photos) == 1
            assert listing_photos[0].content_type == "image/webp"
            assert listing_photos[0].position == 0
            assert len(listing_photos[0].image_bytes) > 0
            assert len(listing_photos[0].image_bytes) <= MAX_PHOTO_BYTES
            assert len(listing_photos[0].image_bytes) <= 300 * 1024
    finally:
        session.close()


def test_seed_listing_photos_is_idempotent(db_connection, monkeypatch):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        seed.seed_listing_photos(session)
        seed.seed_listing_photos(session)
        session.commit()
    finally:
        session.close()

    assert count_rows(session_factory, ListingPhoto) == 8


def test_seed_listing_photos_restores_only_a_missing_listing_photo(
    db_connection,
    monkeypatch,
):
    session_factory = bind_seed_to_connection(db_connection, monkeypatch)
    seed.seed_database()

    session = session_factory()
    try:
        owner = seed.find_member_by_email(session, "bob@example.com")
        listing = seed.find_listing_by_owner_and_title(
            session,
            owner,
            "Fresh Manoa Lettuce",
        )
        original_photos = session.scalars(select(ListingPhoto)).all()
        original_ids_by_listing = {}
        for photo in original_photos:
            original_ids_by_listing[photo.listing_id] = photo.id

        session.execute(
            delete(ListingPhoto).where(ListingPhoto.listing_id == listing.id)
        )
        session.commit()

        seed.seed_listing_photos(session)
        session.commit()

        restored_photos = session.scalars(select(ListingPhoto)).all()
        assert len(restored_photos) == 8
        for photo in restored_photos:
            if photo.listing_id == listing.id:
                assert photo.id != original_ids_by_listing[listing.id]
            else:
                assert photo.id == original_ids_by_listing[photo.listing_id]
    finally:
        session.close()
