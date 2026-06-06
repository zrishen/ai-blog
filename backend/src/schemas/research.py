"""研究图谱相关 Pydantic 模型。"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class ResearchTopicCreate(BaseModel):
    title: str
    description: Optional[str] = None


class ResearchTopicUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    summary: Optional[str] = None


class ResearchTopicRead(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    status: str
    summary: Optional[str] = None
    last_checked_at: Optional[datetime] = None
    source_count: int = 0
    claim_count: int = 0
    conflict_count: int = 0
    entity_count: int = 0
    created_at: datetime
    updated_at: datetime


class ResearchSourceRead(BaseModel):
    id: int
    topic_id: int
    title: str
    url: Optional[str] = None
    canonical_url: Optional[str] = None
    publisher: Optional[str] = None
    source_type: str
    published_at: Optional[datetime] = None
    fetched_at: Optional[datetime] = None
    trust_level: str
    status: str
    raw_excerpt: Optional[str] = None
    metadata_json: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResearchEvidenceRead(BaseModel):
    id: int
    topic_id: int
    source_id: Optional[int] = None
    quote: str
    location: Optional[str] = None
    kind: str
    metadata_json: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResearchClaimCreate(BaseModel):
    claim_text: str
    status: str = "pending"
    confidence: int = 0
    claim_type: Optional[str] = None
    adopted: bool = False
    reasoning: Optional[str] = None
    evidence_ids: list[int] = []
    entity_ids: list[int] = []
    entity_names: list[str] = []


class ResearchClaimUpdate(BaseModel):
    status: Optional[str] = None
    confidence: Optional[int] = None
    adopted: Optional[bool] = None
    reasoning: Optional[str] = None
    evidence_ids: Optional[list[int]] = None


class ResearchConflictResolve(BaseModel):
    accepted_claim_id: int
    rejected_claim_id: int


class ResearchClaimRead(BaseModel):
    id: int
    topic_id: int
    claim_text: str
    status: str
    confidence: int
    claim_type: Optional[str] = None
    adopted: bool
    reasoning: Optional[str] = None
    entity_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResearchEntityCreate(BaseModel):
    name: str
    entity_type: Optional[str] = "other"
    description: Optional[str] = None
    confidence: int = 0
    status: str = "active"
    aliases: list[str] = []


class ResearchEntityUpdate(BaseModel):
    name: Optional[str] = None
    entity_type: Optional[str] = None
    description: Optional[str] = None
    confidence: Optional[int] = None
    status: Optional[str] = None
    aliases: Optional[list[str]] = None


class ResearchEntityRead(BaseModel):
    id: int
    topic_id: int
    name: str
    entity_type: Optional[str] = None
    description: Optional[str] = None
    confidence: int = 0
    status: str = "active"
    aliases_json: Optional[list[str]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ResearchClaimEntityLinkRead(BaseModel):
    id: int
    claim_id: int
    entity_id: int
    topic_id: int
    role: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResearchRelationRead(BaseModel):
    id: int
    topic_id: int
    from_type: str
    from_id: int
    to_type: str
    to_id: int
    relation_type: str
    metadata_json: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResearchProposalRead(BaseModel):
    id: int
    topic_id: int
    proposal_type: str
    title: str
    description: Optional[str] = None
    payload_json: Optional[dict[str, Any]] = None
    status: str
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    applied_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ResearchProposalUpdate(BaseModel):
    status: Optional[str] = None  # approved | rejected | applied | pending


class ResearchRunRead(BaseModel):
    id: int
    topic_id: int
    status: str
    progress: dict[str, Any]
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ResearchTopicDetail(ResearchTopicRead):
    sources: list[ResearchSourceRead] = []
    evidence: list[ResearchEvidenceRead] = []
    claims: list[ResearchClaimRead] = []
    entities: list[ResearchEntityRead] = []
    relations: list[ResearchRelationRead] = []
    claim_entity_links: list[ResearchClaimEntityLinkRead] = []
    proposals: list[ResearchProposalRead] = []


class BlogPostResearchAttach(BaseModel):
    topic_id: int


class BlogPostClaimAttach(BaseModel):
    claim_id: int
    usage_note: str = ""


class BlogPostResearchLinkRead(BaseModel):
    id: int
    post_id: int
    topic_id: int
    snapshot: dict[str, Any]
    created_at: datetime


class BlogPostClaimLinkRead(BaseModel):
    id: int
    post_id: int
    claim_id: int
    topic_id: int
    usage_note: Optional[str] = None
    created_at: datetime


class BlogResearchSummary(BaseModel):
    post_id: int
    topics: list[dict[str, Any]]
    claims: list[dict[str, Any]]
