"""工作区组织层模型：目录树节点 + RAG 索引源。

WorkspaceNode 既是文件夹（folder），也是「某资源挂在某文件夹下」的挂靠关系（resource + resource_type + resource_id）；
无 node 的资源 = 未归档（inbox）。RagSource 记录「加入 AI 知识」的资源及索引状态。
资源用多态关联（resource_type + resource_id）不加跨表 FK——挂靠点可指向任意一张表，FK 无法表达。
"""

from sqlalchemy import (
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

    folder：parent_id 自引用嵌套组织目录；resource：resource_type + resource_id 指向实际内容。
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
    resource_type = Column(String(30), nullable=True)  # blog_post / file（仅 resource）
    resource_id = Column(Integer, nullable=True)
    name = Column(String(300), nullable=False)
    slug = Column(String(300), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class RagSource(Base):
    """RAG 索引源：用户主动加入 AI 知识的资源 + 索引状态机（加入→pending→active，内容变更→stale，移除=删记录+删向量）。"""

    __tablename__ = "rag_sources"
    __table_args__ = (
        UniqueConstraint("user_id", "resource_type", "resource_id", name="uq_rag_sources_resource"),
        Index("ix_rag_sources_user_status", "user_id", "index_status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    resource_type = Column(String(30), nullable=False)  # blog_post / file
    resource_id = Column(Integer, nullable=False)
    index_status = Column(String(20), nullable=False, default="pending")  # pending / active / stale / failed
    indexed_version = Column(String(64), nullable=True)  # 内容版本指纹，判断是否 stale
    collection_name = Column(String(200), nullable=False)  # RAG collection key
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    indexed_at = Column(DateTime, nullable=True)
