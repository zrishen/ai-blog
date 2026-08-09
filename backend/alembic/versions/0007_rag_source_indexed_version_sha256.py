"""allow SHA-256 fingerprints for RAG sources

Revision ID: 0007_rag_sha256
Revises: 0006_blog_content_storage_state
Create Date: 2026-08-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_rag_sha256"
down_revision: Union[str, None] = "0006_blog_content_storage_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "rag_sources",
        "indexed_version",
        existing_type=sa.String(length=60),
        type_=sa.String(length=64),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "rag_sources",
        "indexed_version",
        existing_type=sa.String(length=64),
        type_=sa.String(length=60),
        existing_nullable=True,
    )
