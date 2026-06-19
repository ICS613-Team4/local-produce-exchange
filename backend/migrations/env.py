# Alembic runs this file for every migration command. It connects to the
# database with the same settings as the app and tells Alembic which
# tables the models define, so autogenerate can compare them.

from logging.config import fileConfig

from alembic import context

# Importing app.models registers every table on Base.metadata.
# Without this import, autogenerate would think no tables exist.
import app.models  # noqa: F401

# This import wires the alembic-postgresql-enum plugin into Alembic's
# autogenerate. It makes autogenerate emit the CREATE TYPE on upgrade and
# the DROP TYPE on downgrade for new Postgres enum types (like the
# listing_status enum), so the generated migration is complete and
# reversible with no hand-editing. At upgrade time the import is a no-op.
import alembic_postgresql_enum  # noqa: F401

from app.db import engine
from app.models.base import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

if context.is_offline_mode():
    raise RuntimeError("Offline mode is not used in this project. Run without --sql.")

connection = engine.connect()
try:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()
finally:
    connection.close()
