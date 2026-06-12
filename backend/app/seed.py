# Fills the database with demo data. Tables are created by migrations.
# Run migrations first from the repo root with:
#   npm run db:migrate
# Then run this with:
#   npm run db:seed
# Safe to run more than once: it does nothing when data is already there.

import sys

from sqlalchemy import select

from app.db import SessionLocal
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

# Plaintext for the pending demo invite token — shown once at seed time.
_PENDING_TOKEN_PLAINTEXT = "demo-invite-pending-abc123"


def seed_database():
    session = SessionLocal()
    try:
        existing_row = session.scalars(select(SampleData)).first()
        if existing_row is not None:
            print("Sample data is already present. Nothing to do.")
            return

        # --- sample_data rows (existing demo) ---
        session.add(SampleData(slug="manoa-lettuce", name="Manoa Lettuce", note="Crisp green lettuce grown in Manoa Valley."))
        session.add(SampleData(slug="apple-bananas", name="Apple Bananas", note="Small sweet bananas, a Hawaii favorite."))
        session.add(SampleData(slug="kahuku-corn",   name="Kahuku Corn",   note="Sweet corn from the North Shore."))

        # --- members ---
        alice = Member(name="Alice Admin",  email="alice@example.com",  password_hash=_HASHES[0], role="admin")
        bob   = Member(name="Bob Baker",    email="bob@example.com",    password_hash=_HASHES[1])
        carol = Member(name="Carol Chen",   email="carol@example.com",  password_hash=_HASHES[2])
        dave  = Member(name="Dave Diaz",    email="dave@example.com",   password_hash=_HASHES[3])

        session.add_all([alice, bob, carol, dave])
        session.flush()

        # --- profiles ---
        session.add(MemberProfile(member_id=alice.id, display_name="Alice",  neighborhood="Manoa",       contact_preference="email"))
        session.add(MemberProfile(member_id=bob.id,   display_name="Bob",    neighborhood="Kaimuki",     contact_preference="message"))
        session.add(MemberProfile(member_id=carol.id, display_name="Carol",  neighborhood="Kailua",      contact_preference="either"))
        session.add(MemberProfile(member_id=dave.id,  display_name="Dave",   neighborhood="Pearl City"))

        # --- invite tokens ---
        # One pending token (usable in the registration flow)
        session.add(InviteToken(
            created_by=alice.id,
            token_hash=hash_invite_token(_PENDING_TOKEN_PLAINTEXT),
            status="pending",
        ))
        # One already-used token (Bob used it)
        session.add(InviteToken(
            created_by=alice.id,
            used_by=bob.id,
            token_hash=hash_invite_token("demo-invite-used-xyz789"),
            status="used",
        ))

        session.commit()
        print("Inserted seed data: 3 sample rows, 4 members, 4 profiles, 2 invite tokens.")
        print(f"Pending invite token (use this to register): {_PENDING_TOKEN_PLAINTEXT}")
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
