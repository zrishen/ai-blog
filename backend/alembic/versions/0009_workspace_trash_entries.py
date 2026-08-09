"""add recoverable physical workspace trash entries

Revision ID: 0009_workspace_trash
Revises: 0008_drop_workspace_nodes
Create Date: 2026-08-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_workspace_trash"
down_revision: Union[str, None] = "0008_drop_workspace_nodes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_trash_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("entry_type", sa.String(length=30), nullable=False),
        sa.Column("blog_post_id", sa.Integer(), nullable=True),
        sa.Column("original_path", sa.String(length=500), nullable=False),
        sa.Column("trashed_path", sa.String(length=600), nullable=False, unique=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        if_not_exists=True,
    )
    op.create_index(
        "ix_workspace_trash_entries_user_deleted",
        "workspace_trash_entries",
        ["user_id", "deleted_at"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_workspace_trash_entries_blog",
        "workspace_trash_entries",
        ["blog_post_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_trash_entries_blog", table_name="workspace_trash_entries", if_exists=True)
    op.drop_index("ix_workspace_trash_entries_user_deleted", table_name="workspace_trash_entries", if_exists=True)
    op.drop_table("workspace_trash_entries", if_exists=True)
