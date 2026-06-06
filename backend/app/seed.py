# Fills the database with demo data. Run it from the repo root with:
#   npm run db:seed
# Safe to run more than once: it does nothing when data is already there.

import sys

from sqlalchemy import select

from app.db import SessionLocal, engine
from app.models.base import Base
from app.models.sample_data import SampleData


def seed_database():
    # Create any missing tables. This never changes existing tables.
    Base.metadata.create_all(engine)

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
        print("Is the database running? Try: npm run db")
        sys.exit(1)
