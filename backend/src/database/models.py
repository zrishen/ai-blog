from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, JSON, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase


def _utcnow() -> datetime:
    """Naive UTC datetime, replaces deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_user_deleted", "user_id", "deleted_at"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    image_url = Column(Text, nullable=True)
    file_url = Column(Text, nullable=True)
    token_count = Column(Integer, default=0)
    tool_calls = Column(JSON, nullable=True)
    tool_call_id = Column(String(100), nullable=True)
    reasoning_content = Column(Text, nullable=True)
    thinking_content = Column(Text, nullable=True)
    tool_events = Column(JSON, nullable=True)
    loop_steps = Column(JSON, nullable=True)
    thinking_duration_ms = Column(Integer, nullable=True)
    thinking_mode = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class FileDocument(Base):
    __tablename__ = "file_documents"
    __table_args__ = (Index("ix_file_documents_user_deleted", "user_id", "deleted_at"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    collection_name = Column(String(200), nullable=False)
    user_id = Column(String(100), nullable=False, default="default_user")
    original_name = Column(String(300), nullable=False)
    file_path = Column(String(500), nullable=False)
    chunk_content = Column(Text, nullable=False)
    meta = Column("metadata", Text, nullable=True)
    category_id = Column(Integer, ForeignKey("file_categories.id"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    deleted_at = Column(DateTime, nullable=True)


class FileProcessingJob(Base):
    __tablename__ = "file_processing_jobs"
    __table_args__ = (
        UniqueConstraint("active_key", name="uq_file_processing_jobs_active_key"),
        UniqueConstraint("user_id", "client_request_id", name="uq_file_processing_jobs_user_request"),
        Index("ix_file_processing_jobs_user_status", "user_id", "status"),
        Index("ix_file_processing_jobs_heartbeat", "heartbeat_at"),
        Index("ix_file_processing_jobs_source_document", "source_document_id"),
    )

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_type = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, default="staging")
    current_stage = Column(String(40), nullable=False)
    progress_model_version = Column(String(30), nullable=False)
    progress_percent = Column(Integer, nullable=False, default=0)
    progress_json = Column(JSON, nullable=False, default=dict)
    client_request_id = Column(String(36), nullable=False)
    source_document_id = Column(Integer, ForeignKey("file_documents.id", ondelete="SET NULL"), nullable=True)
    result_document_id = Column(Integer, ForeignKey("file_documents.id", ondelete="SET NULL"), nullable=True)
    original_name = Column(String(300), nullable=False)
    stored_name = Column(String(300), nullable=True)
    collection_name = Column(String(200), nullable=False)
    category_id = Column(Integer, ForeignKey("file_categories.id", ondelete="SET NULL"), nullable=True)
    staging_path = Column(String(500), nullable=True)
    active_key = Column(String(200), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    execution_token = Column(String(36), nullable=True)
    heartbeat_at = Column(DateTime, nullable=True)
    error_code = Column(String(80), nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)


# ---- MCP ----

class MCPServer(Base):
    __tablename__ = "mcp_servers"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_mcp_servers_user_name"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name = Column(String(100), nullable=False)
    server_type = Column(String(20), nullable=False)
    tools = Column(JSON, nullable=True)
    command = Column(Text, nullable=True)
    args = Column(Text, nullable=True)
    env_vars = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


# ---- User LLM settings ----

class LLMSettings(Base):
    __tablename__ = "llm_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_llm_settings_user_id"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    protocol = Column(String(20), nullable=False, default="openai")
    base_url = Column(Text, nullable=True)
    api_key = Column(Text, nullable=True)
    model_name = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


# ---- Blog ----

class BlogCategory(Base):
    __tablename__ = "blog_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_blog_categories_user_slug"),
        UniqueConstraint("user_id", "name", name="uq_blog_categories_user_name"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class BlogPost(Base):
    __tablename__ = "blog_posts"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_blog_posts_user_slug"),
        Index("ix_blog_posts_user_deleted", "user_id", "deleted_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(300), nullable=False)
    slug = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)
    excerpt = Column(String(500), nullable=True)
    cover_image = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="draft")  # draft / published / archived
    category_id = Column(Integer, ForeignKey("blog_categories.id"), nullable=True)
    tags = Column(String(500), nullable=True)
    author = Column(String(100), nullable=True)
    view_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    published_at = Column(DateTime, nullable=True)
    file_path = Column(String(500), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1)
    # AST 缓存(派生数据,可随时从 content 重建):文章正文的块结构数组,
    # 供 AI 章节定位(大纲/读单节)使用,避免读全文消耗 token。
    blocks_json = Column(JSON, nullable=True)
    deleted_at = Column(DateTime, nullable=True)


# ---- Research Graph ----

class ResearchTopic(Base):
    __tablename__ = "research_topics"
    __table_args__ = (
        Index("ix_research_topics_user_status", "user_id", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="draft")
    summary = Column(Text, nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ResearchSource(Base):
    __tablename__ = "research_sources"
    __table_args__ = (
        UniqueConstraint("topic_id", "canonical_url", name="uq_research_sources_topic_canonical_url"),
        Index("ix_research_sources_topic_user", "topic_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    url = Column(Text, nullable=True)
    canonical_url = Column(Text, nullable=True)
    publisher = Column(String(300), nullable=True)
    source_type = Column(String(50), nullable=False, default="manual")
    published_at = Column(DateTime, nullable=True)
    fetched_at = Column(DateTime, nullable=True)
    trust_level = Column(String(30), nullable=False, default="unknown")
    status = Column(String(30), nullable=False, default="pending")
    raw_excerpt = Column(Text, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ResearchEvidence(Base):
    __tablename__ = "research_evidence"
    __table_args__ = (
        Index("ix_research_evidence_topic_user", "topic_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    source_id = Column(Integer, ForeignKey("research_sources.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    quote = Column(Text, nullable=False)
    location = Column(String(300), nullable=True)
    kind = Column(String(50), nullable=False, default="manual")
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class ResearchClaim(Base):
    __tablename__ = "research_claims"
    __table_args__ = (
        Index("ix_research_claims_topic_user", "topic_id", "user_id"),
        Index("ix_research_claims_user_status", "user_id", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    claim_text = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default="pending")
    confidence = Column(Integer, nullable=False, default=0)
    claim_type = Column(String(50), nullable=True)
    adopted = Column(Boolean, nullable=False, default=False)
    reasoning = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ResearchEntity(Base):
    __tablename__ = "research_entities"
    __table_args__ = (
        Index("ix_research_entities_topic_user", "topic_id", "user_id"),
        Index("ix_research_entities_topic_name", "topic_id", "name"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(300), nullable=False)
    entity_type = Column(String(80), nullable=True)
    description = Column(Text, nullable=True)
    aliases_json = Column(JSON, nullable=True)
    confidence = Column(Integer, nullable=False, default=0)
    status = Column(String(30), nullable=False, default="active")
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ResearchClaimEntityLink(Base):
    __tablename__ = "research_claim_entity_links"
    __table_args__ = (
        UniqueConstraint("claim_id", "entity_id", name="uq_claim_entity_link"),
        Index("ix_claim_entity_links_topic_user", "topic_id", "user_id"),
        Index("ix_claim_entity_links_claim", "claim_id"),
        Index("ix_claim_entity_links_entity", "entity_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    claim_id = Column(Integer, ForeignKey("research_claims.id", ondelete="CASCADE"), nullable=False)
    entity_id = Column(Integer, ForeignKey("research_entities.id", ondelete="CASCADE"), nullable=False)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class ResearchRelation(Base):
    __tablename__ = "research_relations"
    __table_args__ = (
        Index("ix_research_relations_topic_user", "topic_id", "user_id"),
        Index("ix_research_relations_from", "from_type", "from_id"),
        Index("ix_research_relations_to", "to_type", "to_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    from_type = Column(String(50), nullable=False)
    from_id = Column(Integer, nullable=False)
    to_type = Column(String(50), nullable=False)
    to_id = Column(Integer, nullable=False)
    relation_type = Column(String(50), nullable=False)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class ResearchProposal(Base):
    __tablename__ = "research_proposals"
    __table_args__ = (
        Index("ix_research_proposals_topic_user", "topic_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    proposal_type = Column(String(50), nullable=False)
    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    payload_json = Column(JSON, nullable=True)
    status = Column(String(30), nullable=False, default="pending")
    created_at = Column(DateTime, default=_utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    applied_at = Column(DateTime, nullable=True)


class ResearchRun(Base):
    __tablename__ = "research_runs"
    __table_args__ = (
        UniqueConstraint("topic_id", "idempotency_key", name="uq_research_runs_topic_idempotency_key"),
        Index("ix_research_runs_topic_user", "topic_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    idempotency_key = Column(String(120), nullable=False)
    status = Column(String(30), nullable=False, default="queued")
    progress_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class BlogPostResearchLink(Base):
    __tablename__ = "blog_post_research_links"
    __table_args__ = (
        UniqueConstraint("post_id", "topic_id", name="uq_blog_post_research_links_post_topic"),
        Index("ix_blog_post_research_links_post_user", "post_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    post_id = Column(Integer, ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    snapshot_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class BlogPostClaimLink(Base):
    __tablename__ = "blog_post_claim_links"
    __table_args__ = (
        UniqueConstraint("post_id", "claim_id", name="uq_blog_post_claim_links_post_claim"),
        Index("ix_blog_post_claim_links_post_user", "post_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    post_id = Column(Integer, ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False)
    claim_id = Column(Integer, ForeignKey("research_claims.id", ondelete="CASCADE"), nullable=False)
    topic_id = Column(Integer, ForeignKey("research_topics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    usage_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


# ---- File Library Categories ----

class FileCategory(Base):
    __tablename__ = "file_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_file_categories_user_slug"),
        UniqueConstraint("user_id", "name", name="uq_file_categories_user_name"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("file_categories.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)


# ---- Auth ----

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=_utcnow)
