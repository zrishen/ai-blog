"""encrypt legacy plain-text LLM api keys

 Revision ID: 0002_encrypt_legacy_keys
 Revises: 0001_initial_schema
 Create Date: 2026-08-01
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "0002_encrypt_legacy_keys"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 兼容旧部署：把明文 LLM api_key 加密。无明文 key 时为 no-op。
    from src.utils.secret_crypto import encrypt_secret, is_encrypted_secret

    bind = op.get_bind()
    rows = bind.execute(
        text("SELECT id, api_key FROM llm_settings WHERE api_key IS NOT NULL AND api_key <> ''")
    ).mappings().all()
    for row in rows:
        value = row["api_key"]
        if is_encrypted_secret(value):
            continue
        bind.execute(
            text("UPDATE llm_settings SET api_key = :api_key WHERE id = :id"),
            {"api_key": encrypt_secret(value), "id": row["id"]},
        )


def downgrade() -> None:
    # 不可逆（不还原明文）。
    pass
