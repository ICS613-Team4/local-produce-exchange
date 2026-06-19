# Fills the database with demo data. Tables are created by migrations.
# Run migrations first from the repo root with:
#   npm run db:migrate
# Then run this with:
#   npm run db:seed
#
# Safe to run more than once. Most demo groups check their own table: if that
# table is empty the rows are inserted, and if the table already has rows that
# group is skipped. Listings check each demo row by owner and title, so a
# database with the two older demo listings still gets the six newer ones.

import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.db import SessionLocal
from app.models.listing import Listing
from app.models.member import InviteToken, Member, MemberProfile
from app.models.sample_data import SampleData
from app.security import hash_invite_token

# All seed members use "password" as their password.
_HASHES = [
    "$2b$12$ZvpgIOj0R70HIm5weBBxBeMw3654Kx9v6q6R4.D7YI9MkLIJiMGiu",
    "$2b$12$pPJeQeNnQ2ube5f1B33OsuekyZHVlN/IkXHJ7vfWE4KZj81zVcgYq",
    "$2b$12$mhLUc4NY3E0oXKT55xmbeuhNIxtOwPe1kKeUKwVYPbbx4jplvB1hG",
    "$2b$12$D87RT4vw8S19Gl4PSo1Ck.JqLJxoPcpWVLlj.d0wuzSjaG99vCVk2",
]

# Plaintext for the pending demo invite token - shown once at seed time.
_PENDING_TOKEN_PLAINTEXT = "demo-invite-pending-abc123"


def table_is_empty(session, model):
    # Returns True when the given table has no rows yet.
    first_row = session.scalars(select(model)).first()
    if first_row is None:
        return True
    return False


def find_member_by_email(session, email):
    # Looks up a member by their unique email. Profiles and invite tokens
    # point at members by id, so we find the member here instead of
    # assuming it was created earlier in this same run.
    statement = select(Member).where(Member.email == email)
    member = session.scalars(statement).first()
    return member


def add_listing_if_missing(session, listing):
    # Use owner plus title as the seed identity. The owner is found by email
    # before the listing is built, so this works across databases with different
    # generated member ids.
    statement = select(Listing).where(Listing.owner_id == listing.owner_id).where(Listing.title == listing.title)
    existing_listing = session.scalars(statement).first()
    if existing_listing is not None:
        return False
    session.add(listing)
    return True


def seed_sample_data(session):
    if not table_is_empty(session, SampleData):
        print("Sample data already present. Skipping sample rows.")
        return

    session.add(SampleData(slug="manoa-lettuce", name="Manoa Lettuce", note="Crisp green lettuce grown in Manoa Valley."))
    session.add(SampleData(slug="apple-bananas", name="Apple Bananas", note="Small sweet bananas, a Hawaii favorite."))
    session.add(SampleData(slug="kahuku-corn",   name="Kahuku Corn",   note="Sweet corn from the North Shore."))
    print("Inserted 3 sample rows.")


def seed_members(session):
    if not table_is_empty(session, Member):
        print("Members already present. Skipping members.")
        return

    alice = Member(name="Alice Admin", email="alice@example.com", password_hash=_HASHES[0], role="admin")
    bob   = Member(name="Bob Baker",   email="bob@example.com",   password_hash=_HASHES[1])
    carol = Member(name="Carol Chen",  email="carol@example.com", password_hash=_HASHES[2])
    dave  = Member(name="Dave Diaz",   email="dave@example.com",  password_hash=_HASHES[3])

    session.add_all([alice, bob, carol, dave])
    print("Inserted 4 members.")


def seed_profiles(session):
    if not table_is_empty(session, MemberProfile):
        print("Member profiles already present. Skipping profiles.")
        return

    # Look each member up by email. If members were just inserted above
    # and not flushed yet, this query flushes them first, so they have
    # their ids by the time we read them.
    alice = find_member_by_email(session, "alice@example.com")
    bob = find_member_by_email(session, "bob@example.com")
    carol = find_member_by_email(session, "carol@example.com")
    dave = find_member_by_email(session, "dave@example.com")

    if alice is not None:
        session.add(MemberProfile(member_id=alice.id, display_name="Alice", neighborhood="Manoa", contact_preference="email"))
    if bob is not None:
        session.add(MemberProfile(member_id=bob.id, display_name="Bob", neighborhood="Kaimuki", contact_preference="message"))
    if carol is not None:
        session.add(MemberProfile(member_id=carol.id, display_name="Carol", neighborhood="Kailua", contact_preference="either"))
    if dave is not None:
        session.add(MemberProfile(member_id=dave.id, display_name="Dave", neighborhood="Pearl City"))
    print("Inserted member profiles.")


def seed_invite_tokens(session):
    if not table_is_empty(session, InviteToken):
        print("Invite tokens already present. Skipping invite tokens.")
        return

    # Both demo tokens are tied to seed members, so we need Alice (the
    # creator) and Bob (who used one). If the seed members are missing,
    # skip the tokens rather than insert a broken reference.
    alice = find_member_by_email(session, "alice@example.com")
    bob = find_member_by_email(session, "bob@example.com")
    if alice is None or bob is None:
        print("Seed members are missing, so invite tokens were skipped.")
        return

    # One pending token (usable in the registration flow).
    session.add(InviteToken(
        created_by=alice.id,
        token_hash=hash_invite_token(_PENDING_TOKEN_PLAINTEXT),
        status="pending",
    ))
    # One already-used token (Bob used it).
    session.add(InviteToken(
        created_by=alice.id,
        used_by=bob.id,
        token_hash=hash_invite_token("demo-invite-used-xyz789"),
        status="used",
    ))
    print("Inserted 2 invite tokens.")
    print(f"Pending invite token (use this to register): {_PENDING_TOKEN_PLAINTEXT}")


def seed_listings(session):
    # Demo listings need an owner. Look the seed members up by email; if any
    # owner we need is missing, skip rather than insert a listing with a broken
    # owner. All four demo members can own a listing now.
    bob = find_member_by_email(session, "bob@example.com")
    carol = find_member_by_email(session, "carol@example.com")
    dave = find_member_by_email(session, "dave@example.com")
    alice = find_member_by_email(session, "alice@example.com")
    if bob is None or carol is None or dave is None or alice is None:
        print("Seed members are missing, so listings were skipped.")
        return

    # Each pickup window is one range value: the start is included and the end
    # is not. Build three windows off a single "now" and reuse them across the
    # listings, so the demo data has current pickup times without a lot of code.
    window_start = datetime.now(timezone.utc)
    window_end = window_start + timedelta(days=2)
    pickup_window = Range(window_start, window_end, bounds="[)")
    window_two = Range(window_start + timedelta(days=1), window_start + timedelta(days=3), bounds="[)")
    window_three = Range(window_start + timedelta(days=2), window_start + timedelta(days=4), bounds="[)")

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
    # Six more realistic demo listings across all four members, so the detail
    # page has real content to open. Each starts with remaining equal to total.
    lemons = Listing(
        owner_id=dave.id,
        title="Backyard Meyer Lemons",
        description="Sweet, fragrant Meyer lemons from a backyard tree in Pearl City. Great for lemonade or baking. Bring your own bag.",
        category="Fruit",
        dietary_tags=["vegan", "vegetarian"],
        allergen_tags=[],
        total_quantity=24,
        remaining_quantity=24,
        pickup_window=window_two,
        status="active",
    )
    kabocha = Listing(
        owner_id=bob.id,
        title="Kabocha Squash",
        description="A few small kabocha squash from this season's garden. Firm and sweet, good for roasting or soup.",
        category="Vegetables",
        dietary_tags=["vegan", "vegetarian", "gluten-free"],
        allergen_tags=[],
        total_quantity=4,
        remaining_quantity=4,
        pickup_window=window_three,
        status="active",
    )
    banana_bread = Listing(
        owner_id=carol.id,
        title="Homemade Banana Bread",
        description="Two fresh loaves made with our extra apple bananas. Contains walnuts. Baked this weekend.",
        category="Baked goods",
        dietary_tags=["vegetarian"],
        allergen_tags=["contains wheat", "contains eggs", "contains nuts"],
        total_quantity=2,
        remaining_quantity=2,
        pickup_window=pickup_window,
        status="active",
    )
    avocados = Listing(
        owner_id=alice.id,
        title="Williams Avocados",
        description="Large, creamy Williams avocados, picked hard so they travel well. Let them ripen on the counter for a few days.",
        category="Fruit",
        dietary_tags=["vegan", "vegetarian"],
        allergen_tags=[],
        total_quantity=8,
        remaining_quantity=8,
        pickup_window=window_two,
        status="active",
    )
    farm_eggs = Listing(
        owner_id=dave.id,
        title="Farm Eggs",
        description="Three dozen eggs from our backyard hens in Pearl City, mixed brown and white. Returning the carton is appreciated.",
        category="Dairy and eggs",
        dietary_tags=["vegetarian"],
        allergen_tags=["contains eggs"],
        total_quantity=3,
        remaining_quantity=3,
        pickup_window=window_three,
        status="active",
    )
    thai_basil = Listing(
        owner_id=carol.id,
        title="Thai Basil",
        description="Big aromatic bunches of Thai basil from the Kailua garden. Perfect for pho, curry, or stir-fry.",
        category="Herbs",
        dietary_tags=["vegan", "vegetarian"],
        allergen_tags=[],
        total_quantity=12,
        remaining_quantity=12,
        pickup_window=pickup_window,
        status="active",
    )

    inserted_count = 0
    if add_listing_if_missing(session, lettuce):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, bananas):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, lemons):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, kabocha):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, banana_bread):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, avocados):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, farm_eggs):
        inserted_count = inserted_count + 1
    if add_listing_if_missing(session, thai_basil):
        inserted_count = inserted_count + 1

    if inserted_count == 0:
        print("Listings already present. Skipping listing rows.")
    else:
        print("Inserted " + str(inserted_count) + " listings.")


def seed_database():
    session = SessionLocal()
    try:
        # Order matters: members come before profiles, invite tokens, and
        # listings, because those three point back at members.
        seed_sample_data(session)
        seed_members(session)
        seed_profiles(session)
        seed_invite_tokens(session)
        seed_listings(session)
        session.commit()
    finally:
        session.close()


if __name__ == "__main__":
    try:
        seed_database()
    except Exception as error:
        # A short message instead of a wall of traceback text.
        print("Seeding failed: " + str(error))
        print("Is the database running and migrated?")
        print("Try: npm run db:up, then npm run db:migrate, then npm run db:seed")
        sys.exit(1)
