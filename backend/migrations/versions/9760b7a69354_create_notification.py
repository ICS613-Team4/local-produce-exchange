"""create notification

Revision ID: 9760b7a69354
Revises: 1b1296bd0986
Create Date: 2026-07-18 11:58:48.931834

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "9760b7a69354"
down_revision: Union[str, Sequence[str], None] = "1b1296bd0986"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "notification",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("member_id", sa.UUID(), nullable=False),
        sa.Column("claim_id", sa.UUID(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "is_read", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claim.id"],
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["member.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notification_member_created",
        "notification",
        ["member_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_notification_member_unread",
        "notification",
        ["member_id"],
        unique=False,
        postgresql_where=sa.text("is_read = false"),
    )
    # Autogenerate also proposed dropping the real message and message_thread
    # tables, because backend/app/models/thread.py is not imported in
    # app/models/__init__.py so Base.metadata does not see them. Those tables
    # are in use; the drops were removed by hand.


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_notification_member_unread",
        table_name="notification",
        postgresql_where=sa.text("is_read = false"),
    )
    op.drop_index("ix_notification_member_created", table_name="notification")
    op.drop_table("notification")
