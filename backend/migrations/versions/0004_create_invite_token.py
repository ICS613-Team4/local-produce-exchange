"""create invite_token table

Revision ID: e4f5a6b7c804
Revises: e3f4a5b6c703
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "e4f5a6b7c804"
down_revision: Union[str, Sequence[str], None] = "e3f4a5b6c703"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invite_token",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("member.id"),
            nullable=False,
        ),
        sa.Column(
            "used_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("member.id"),
            nullable=True,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "status",
            PGEnum("pending", "used", "expired", name="invite_status", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_invite_token_hash"),
    )
    op.create_index("idx_invite_token_created_by", "invite_token", ["created_by"])
    op.create_index("idx_invite_token_used_by", "invite_token", ["used_by"])


def downgrade() -> None:
    op.drop_index("idx_invite_token_used_by", table_name="invite_token")
    op.drop_index("idx_invite_token_created_by", table_name="invite_token")
    op.drop_table("invite_token")
