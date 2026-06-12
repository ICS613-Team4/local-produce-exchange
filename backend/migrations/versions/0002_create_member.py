"""create member table

Revision ID: e2f3a4b5c602
Revises: e1f2a3b4c501
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "e2f3a4b5c602"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c501"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "status",
            PGEnum("active", "suspended", "inactive", name="member_status", create_type=False),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "role",
            PGEnum("member", "admin", name="member_role", create_type=False),
            nullable=False,
            server_default="member",
        ),
        sa.Column("suspended_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("email", name="uq_member_email"),
    )


def downgrade() -> None:
    op.drop_table("member")
