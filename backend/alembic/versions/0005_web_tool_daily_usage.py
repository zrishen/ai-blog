"""add web tool daily usage

Revision ID: 0005_web_tool_daily_usage
Revises: 0004_drop_research_tables
Create Date: 2026-08-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_web_tool_daily_usage"
down_revision: Union[str, None] = "0004_drop_research_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0001 uses current Base.metadata as its fresh-db baseline.  The guarded
    # create therefore supports both a fresh database and an older upgrade.
    op.create_table(
        "web_tool_daily_usage",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "usage_date", name="uq_web_tool_daily_usage_user_date"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_web_tool_daily_usage_user_id",
        "web_tool_daily_usage",
        ["user_id"],
        unique=False,
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("web_tool_daily_usage", if_exists=True)
