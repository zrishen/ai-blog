"""add image_base64_cache to chat_attachments

Revision ID: 0003_chat_attachment_image_cache
Revises: 0002_encrypt_legacy_keys
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_chat_attachment_image_cache"
down_revision: Union[str, None] = "0002_encrypt_legacy_keys"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chat_attachments", sa.Column("image_base64_cache", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_attachments", "image_base64_cache")
