"""initial schema (cortex baseline: 全部业务表)

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-01
"""
from typing import Sequence, Union

from alembic import op

from src.database.models import Base

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 用 models 元数据建全部业务表（models 是 schema 唯一源）。
    # 后续结构变更走 `alembic revision --autogenerate` 生成增量 revision。
    Base.metadata.create_all(op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(op.get_bind())
