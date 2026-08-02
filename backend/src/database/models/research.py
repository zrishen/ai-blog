"""研究图谱模型：主题/来源/证据/事实/实体/关系/提案/运行 + 文章关联。"""

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
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, _utcnow


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
    metadata_json = Column(JSONB, nullable=True)
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
    metadata_json = Column(JSONB, nullable=True)
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
    aliases_json = Column(JSONB, nullable=True)
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
    metadata_json = Column(JSONB, nullable=True)
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
    payload_json = Column(JSONB, nullable=True)
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
    progress_json = Column(JSONB, nullable=True)
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
    snapshot_json = Column(JSONB, nullable=False)
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
