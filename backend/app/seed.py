# Fills the database with demo data. Tables are created by migrations.
# Run migrations first from the repo root with:
#   npm run db:migrate
# Then run this with:
#   npm run db:seed
#
# Safe to run more than once. Each group of demo rows checks its own
# table on its own: if that table is empty the rows are inserted, and if
# the table already has rows that group is skipped. So if some demo rows
# get deleted later (even on production), the next run puts back only the
# groups that are missing and leaves the groups that are still there
# alone. This is different from the old version, which decided whether to
# seed anything at all by looking at just one table (sample_data), so a
# table added later never got its demo rows on a database that already
# had sample rows.

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
    if not table_is_empty(session, Listing):
        print("Listings already present. Skipping listings.")
        return

    # Demo listings need an owner. Look the seed members up by email; if they
    # are missing, skip rather than insert a listing with a broken owner.
    bob = find_member_by_email(session, "bob@example.com")
    carol = find_member_by_email(session, "carol@example.com")
    if bob is None or carol is None:
        print("Seed members are missing, so listings were skipped.")
        return

    # The pickup window is one range value: the start is included and the end
    # is not. Use a window that starts now and runs two days, so a later browse
    # story has a current listing to show.
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
    print("Inserted 2 listings.")


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
