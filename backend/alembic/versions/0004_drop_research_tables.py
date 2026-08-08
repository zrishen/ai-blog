"""drop research domain tables

Revision ID: 0004_drop_research_tables
Revises: 0003_chat_attachment_image_cache
Create Date: 2026-08-07

退役 research（研究图谱）域：删除 11 张 research 表，并清理 workspace / rag_sources
里指向 research 资源的悬空挂靠（resource_type 为多态字符串，非 FK，删表不破坏 schema）。
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004_drop_research_tables"
down_revision: Union[str, None] = "0003_chat_attachment_image_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 先清理 workspace_nodes / rag_sources 中指向 research 资源的悬空挂靠行
    op.execute("DELETE FROM workspace_nodes WHERE resource_type IN ('research_topic', 'research_claim')")
    op.execute("DELETE FROM rag_sources WHERE resource_type IN ('research_topic', 'research_claim')")

    # 按 FK 反序 drop 11 张 research 表
    # if_exists：0001 baseline 用 create_all 按 model 建表（model 已删 research 表 → 不建），
    # 全新库这些表不存在，幂等防 UndefinedTableError；旧库（research 曾上线）正常 drop。
    op.drop_table("blog_post_claim_links", if_exists=True)
    op.drop_table("blog_post_research_links", if_exists=True)
    op.drop_table("research_claim_entity_links", if_exists=True)
    op.drop_table("research_relations", if_exists=True)
    op.drop_table("research_proposals", if_exists=True)
    op.drop_table("research_runs", if_exists=True)
    op.drop_table("research_claims", if_exists=True)
    op.drop_table("research_evidence", if_exists=True)
    op.drop_table("research_entities", if_exists=True)
    op.drop_table("research_sources", if_exists=True)
    op.drop_table("research_topics", if_exists=True)


def downgrade() -> None:
    # 不可逆：research 域已退役，不提供重建。
    raise NotImplementedError("research domain dropped; downgrade not supported")
