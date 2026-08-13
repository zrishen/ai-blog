"""add user-scoped skill settings

Revision ID: 0010_user_skill_settings
Revises: 0009_workspace_trash
Create Date: 2026-08-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0010_user_skill_settings"
down_revision: Union[str, None] = "0009_workspace_trash"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_skill_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "enabled_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_skill_settings_user_id"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_user_skill_settings_user_id",
        "user_skill_settings",
        ["user_id"],
        unique=False,
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_skill_settings_user_id",
        table_name="user_skill_settings",
        if_exists=True,
    )
    op.drop_table("user_skill_settings", if_exists=True)
