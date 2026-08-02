"""大脑只读 API 响应模型：知识图谱 / 记忆 / 偏好 / 统计。"""

from pydantic import BaseModel, Field


class BrainStats(BaseModel):
    enabled: bool
    entities: int = 0
    facts: int = 0
    episodes: int = 0
    preferences: int = 0
    chunks: int = 0
    documents: int = 0


class BrainEntity(BaseModel):
    entity_id: str
    name: str
    entity_type: str | None = None
    aliases: list[str] = []
    description: str | None = None
    confidence: float = 1.0
    created_at: str | None = None
    last_accessed_at: str | None = None


class BrainEpisode(BaseModel):
    episode_id: str
    kind: str
    summary: str
    occurred_at: str | None = None
    conversation_id: int | None = None
    participants: list[str] = []


class BrainPreference(BaseModel):
    pref_id: str
    key: str
    value: str
    confidence: float = 1.0
    valid_from: str | None = None


class BrainFact(BaseModel):
    fact_id: str
    subject_id: str
    predicate: str
    object_text: str
    valid_from: str | None = None
    valid_to: str | None = None
    confidence: float = 1.0
    source_doc_id: str | None = None


class BrainGraphNode(BaseModel):
    id: str
    name: str
    entity_type: str | None = None
    confidence: float = 1.0


class BrainGraphEdge(BaseModel):
    source: str
    type: str
    target: str
    weight: float = 1.0


class BrainGraph(BaseModel):
    nodes: list[BrainGraphNode]
    edges: list[BrainGraphEdge]


class BrainFactCorrection(BaseModel):
    object_text: str = Field(min_length=1, max_length=2000)
    predicate: str | None = Field(default=None, min_length=1, max_length=200)
    confidence: float | None = Field(default=None, ge=0, le=1)


class BrainPreferenceUpdate(BaseModel):
    value: str = Field(min_length=1, max_length=2000)
    confidence: float | None = Field(default=None, ge=0, le=1)
