"""drop the virtual workspace node tree

Revision ID: 0008_drop_workspace_nodes
Revises: 0007_rag_sha256
Create Date: 2026-08-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_drop_workspace_nodes"
down_revision: Union[str, None] = "0007_rag_sha256"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("workspace_nodes", if_exists=True)


def downgrade() -> None:
    op.create_table(
        "workspace_nodes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("workspace_nodes.id"), nullable=True),
        sa.Column("node_type", sa.String(length=20), nullable=False),
        sa.Column("resource_type", sa.String(length=30), nullable=True),
        sa.Column("resource_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("slug", sa.String(length=300), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_workspace_nodes_resource"),
        if_not_exists=True,
    )
    op.create_index("ix_workspace_nodes_user_deleted", "workspace_nodes", ["user_id", "deleted_at"])
    op.create_index("ix_workspace_nodes_parent", "workspace_nodes", ["parent_id"])
