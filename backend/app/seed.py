# Fills the database with demo data. Tables are created by migrations.
# Run migrations first from the repo root with:
#   npm run db:migrate
# Then run this with:
#   npm run db:seed
# Safe to run more than once: it does nothing when data is already there.

import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models.sample_data import SampleData


def seed_database():
    session = SessionLocal()
    try:
        existing_row = session.scalars(select(SampleData)).first()
        if existing_row is not None:
            print("Sample data is already present. Nothing to do.")
            return

        lettuce = SampleData(
            slug="manoa-lettuce",
            name="Manoa Lettuce",
            note="Crisp green lettuce grown in Manoa Valley.",
        )
        bananas = SampleData(
            slug="apple-bananas",
            name="Apple Bananas",
            note="Small sweet bananas, a Hawaii favorite.",
        )
        corn = SampleData(
            slug="kahuku-corn",
            name="Kahuku Corn",
            note="Sweet corn from the North Shore.",
        )

        session.add(lettuce)
        session.add(bananas)
        session.add(corn)
        session.commit()
        print("Inserted 3 sample data rows.")
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
