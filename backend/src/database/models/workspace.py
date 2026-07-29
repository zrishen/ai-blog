"""工作区组织层模型：目录树节点 + RAG 索引源。

WorkspaceNode 既是文件夹（node_type=folder），也是「某资源挂在某文件夹下」的挂靠关系
（node_type=resource + resource_type + resource_id）。无 node 的资源 = 未归档（inbox）。

RagSource 记录用户主动「加入 AI 知识」的资源及其索引状态；与资源类型、存放位置正交。

资源用多态关联（resource_type + resource_id），不加跨表 ForeignKey——因为一个挂靠点可指向
blog_posts / file_documents / research_topics 中的任意一张表，FK 无法表达。
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, _utcnow


class WorkspaceNode(Base):
    """工作区目录树节点。

    folder 节点：parent_id 自引用嵌套，组织目录结构。
    resource 节点：resource_type + resource_id 指向被挂靠的实际内容，parent_id 是所在文件夹。
    一个资源至多一个挂靠点（uq_workspace_nodes_resource），无挂靠点即未归档。
    """

    __tablename__ = "workspace_nodes"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_workspace_nodes_resource"),
        Index("ix_workspace_nodes_user_deleted", "user_id", "deleted_at"),
        Index("ix_workspace_nodes_parent", "parent_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("workspace_nodes.id"), nullable=True)
    node_type = Column(String(20), nullable=False)  # folder / resource
    resource_type = Column(String(30), nullable=True)  # blog_post / file / research_topic（仅 resource）
    resource_id = Column(Integer, nullable=True)
    name = Column(String(300), nullable=False)
    slug = Column(String(300), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    auto_index = Column(Boolean, nullable=False, default=False)  # 目录级「自动加入 AI 知识」
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class RagSource(Base):
    """RAG 索引源：用户主动加入 AI 知识的资源 + 索引状态机。

    与资源类型、存放位置正交——文件/文章/研究事实均可成为 RagSource。
    加入=建记录(pending)→索引(active)；内容变更=stale；移除=删记录+删向量。
    一个资源至多一条 RagSource（uq_rag_sources_resource）。
    """

    __tablename__ = "rag_sources"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_rag_sources_resource"),
        Index("ix_rag_sources_user_status", "user_id", "index_status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    resource_type = Column(String(30), nullable=False)  # blog_post / file / research_topic / research_claim
    resource_id = Column(Integer, nullable=False)
    index_status = Column(String(20), nullable=False, default="pending")  # pending / active / stale / failed
    indexed_version = Column(String(60), nullable=True)  # 内容版本指纹，判断是否 stale
    collection_name = Column(String(200), nullable=False)  # ChromaDB 集合名
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    indexed_at = Column(DateTime, nullable=True)
