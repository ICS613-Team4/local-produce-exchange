"""create member_profile table

Revision ID: e3f4a5b6c703
Revises: e2f3a4b5c602
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "e3f4a5b6c703"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c602"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member_profile",
        sa.Column(
            "member_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("member.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column(
            "contact_preference",
            PGEnum("email", "message", "either", name="contact_pref", create_type=False),
            nullable=True,
        ),
        sa.Column("neighborhood", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("member_profile")
