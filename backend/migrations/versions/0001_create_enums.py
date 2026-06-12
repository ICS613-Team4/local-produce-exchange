"""create enums for auth and member features

Revision ID: e1f2a3b4c501
Revises: cd9306b0de55
Create Date: 2026-06-11

"""
from typing import Sequence, Union

from alembic import op

revision: str = "e1f2a3b4c501"
down_revision: Union[str, Sequence[str], None] = "cd9306b0de55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE member_status AS ENUM ('active', 'suspended', 'inactive')")
    op.execute("CREATE TYPE member_role   AS ENUM ('member', 'admin')")
    op.execute("CREATE TYPE invite_status AS ENUM ('pending', 'used', 'expired')")
    op.execute("CREATE TYPE contact_pref  AS ENUM ('email', 'message', 'either')")


def downgrade() -> None:
    op.execute("DROP TYPE IF EXISTS contact_pref")
    op.execute("DROP TYPE IF EXISTS invite_status")
    op.execute("DROP TYPE IF EXISTS member_role")
    op.execute("DROP TYPE IF EXISTS member_status")
