# A small demo table that proves the database wiring works end to end.
# Replace or delete this once the real schema is designed.

from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SampleData(Base):
    __tablename__ = "sample_data"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    note: Mapped[str]
