"""prepare blog content storage migration state

Revision ID: 0006_blog_content_storage_state
Revises: 0005_web_tool_daily_usage
Create Date: 2026-08-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_blog_content_storage_state"
down_revision: Union[str, None] = "0005_web_tool_daily_usage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0001 creates tables from current metadata for fresh installs.  Guard all
    # additions so this remains safe for both those databases and old upgrades.
    op.add_column(
        "blog_posts",
        sa.Column("content_storage_state", sa.String(length=20), nullable=False, server_default=sa.text("'legacy'")),
        if_not_exists=True,
    )
    op.add_column("blog_posts", sa.Column("content_sha256", sa.String(length=64), nullable=True), if_not_exists=True)
    op.add_column("blog_posts", sa.Column("file_migrated_at", sa.DateTime(), nullable=True), if_not_exists=True)
    op.add_column("blog_posts", sa.Column("last_storage_error", sa.Text(), nullable=True), if_not_exists=True)
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'ck_blog_posts_content_storage_state'
                  AND conrelid = 'blog_posts'::regclass
            ) THEN
                ALTER TABLE blog_posts
                    ADD CONSTRAINT ck_blog_posts_content_storage_state
                    CHECK (content_storage_state IN ('legacy', 'verified', 'error'));
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'ck_blog_posts_content_storage_state'
                  AND conrelid = 'blog_posts'::regclass
            ) THEN
                ALTER TABLE blog_posts DROP CONSTRAINT ck_blog_posts_content_storage_state;
            END IF;
        END $$;
        """
    )
    op.drop_column("blog_posts", "last_storage_error", if_exists=True)
    op.drop_column("blog_posts", "file_migrated_at", if_exists=True)
    op.drop_column("blog_posts", "content_sha256", if_exists=True)
    op.drop_column("blog_posts", "content_storage_state", if_exists=True)
