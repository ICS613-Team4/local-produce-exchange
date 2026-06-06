# The shared base class that every database model will inherit from.
# Real models arrive once the database design is settled.

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
