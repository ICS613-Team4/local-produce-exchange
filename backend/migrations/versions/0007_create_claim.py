"""create claim table and claim_status enum

Revision ID: a1b2c3d4e507
Revises: 02be483a62ce
Create Date: 2026-06-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "a1b2c3d4e507"
down_revision: Union[str, Sequence[str], None] = "02be483a62ce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the claim_status enum type first.
    op.execute(
        "CREATE TYPE claim_status AS ENUM "
        "('requested', 'approved', 'picked_up', 'completed', 'cancelled', 'denied')"
    )

    op.create_table(
        "claim",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "listing_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("listing.id"),
            nullable=False,
        ),
        sa.Column(
            "claimant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("member.id"),
            nullable=False,
        ),
        sa.Column("requested_quantity", sa.Integer(), nullable=False),
        sa.Column("approved_quantity", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            PGEnum(
                "requested", "approved", "picked_up", "completed", "cancelled", "denied",
                name="claim_status",
                create_type=False,
            ),
            nullable=False,
            server_default="requested",
        ),
        sa.Column(
            "requested_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("approved_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("picked_up_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("denied_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint("requested_quantity > 0", name="ck_claim_requested_quantity_positive"),
        sa.CheckConstraint("approved_quantity > 0", name="ck_claim_approved_quantity_positive"),
    )

    # Unique partial index: at most one open (status = 'requested') claim per
    # member per listing. Once a claim moves to a terminal status the member can
    # submit a new one.
    op.create_index(
        "uq_claim_one_open",
        "claim",
        ["listing_id", "claimant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'requested'"),
    )


def downgrade() -> None:
    op.drop_index("uq_claim_one_open", table_name="claim")
    op.drop_table("claim")
    op.execute("DROP TYPE IF EXISTS claim_status")
