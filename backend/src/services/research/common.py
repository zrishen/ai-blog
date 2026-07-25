"""研究图谱通用层：领域常量 + 共享工具函数（owned 查询、计数、归一化、证据校验等）。

被 topic / entity / claim / relation / proposal / run / post_link 各模块复用，
是 research 域的依赖根（不依赖其他 research 子模块）。
"""

import logging
import re
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    BlogPost,
    ResearchClaim,
    ResearchEntity,
    ResearchEvidence,
    ResearchRelation,
    ResearchSource,
    ResearchTopic,
)

logger = logging.getLogger(__name__)

SUPPORTED_EVIDENCE_KINDS = {"web", "knowledge_base", "mcp_tool", "manual"}
ENTITY_TYPES = {"concept", "technology", "person", "organization", "product", "method", "claim_subject", "other"}
ENTITY_STATUSES = {"active", "inactive", "disputed"}
VALID_RELATION_TYPES = {
    "supports", "conflicts_with", "updates", "outdated_by", "mentions", "derived_from",
    "uses", "improves", "reduces", "depends_on", "part_of", "is_a", "related_to",
}
VALID_RELATION_NODE_TYPES = {"source", "evidence", "claim", "entity"}
AUTO_ADOPT_MIN_CONFIDENCE = 85
DEFAULT_RUN_PROGRESS = {
    "search_sources": "queued",
    "fetch_pages": "queued",
    "extract_claims": "queued",
    "detect_conflicts": "queued",
    "await_review": "queued",
}

RESEARCH_RUN_PROMPT = """你是一个研究分析助手。你正在对研究主题执行系统化的信息收集和事实核查。

当前研究主题：「{title}」
主题描述：{description}

按以下阶段逐步推进，每个阶段完成后再进入下一阶段：

阶段 1 — 搜索来源：使用 MCP 工具搜索与主题相关的信息源，保存有价值的来源。
阶段 2 — 抓取页面：对找到的来源，抓取页面内容并提取原文证据片段。
阶段 3 — 提取事实：基于收集的证据，提炼出可验证的事实声明（Claim），每条 Claim 必须关联至少一条 Evidence。
阶段 4 — 检测冲突：检查已提取的事实之间是否存在矛盾，标记冲突关系。
阶段 5 — 完成：总结研究成果。

规则：
- 搜索摘要只能作为线索（source_type=search_summary），不能保存为最终 Evidence
- 没有有效 Evidence 的 Claim 不能进入 supported
- 低可信来源（trust_level=low）不能自动 adopted
- 置信度 >= 85 且有有效证据且无冲突的 Claim 可自动 adopted
"""


async def _get_owned_topic(db: AsyncSession, topic_id: int, user_id: int) -> ResearchTopic | None:
    result = await db.execute(
        select(ResearchTopic).where(ResearchTopic.id == topic_id, ResearchTopic.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _get_owned_post(db: AsyncSession, post_id: int, user_id: int) -> BlogPost | None:
    result = await db.execute(
        select(BlogPost).where(
            BlogPost.id == post_id,
            BlogPost.user_id == user_id,
            BlogPost.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def _count(db: AsyncSession, model, *conditions) -> int:
    result = await db.execute(select(func.count(model.id)).where(*conditions))
    return int(result.scalar_one())


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _clamp_confidence(confidence: int | None) -> int:
    return max(0, min(100, _coerce_int(confidence)))


def _normalize_entity_name(name: str) -> str:
    return " ".join(str(name).strip().split())


def _coerce_str_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    values = value if isinstance(value, list) else str(value).split(",")
    items: list[str] = []
    for item in values:
        text = _normalize_entity_name(str(item))
        if text and text not in items:
            items.append(text)
    return items


def _payload_int_list(payload: dict[str, Any], *keys: str) -> list[int]:
    ids: list[int] = []
    for key in keys:
        value = payload.get(key)
        if value is None or value == "":
            continue
        values = value if isinstance(value, list) else str(value).split(",")
        for item in values:
            parsed = _coerce_int(item)
            if parsed > 0 and parsed not in ids:
                ids.append(parsed)
    return ids


def _normalize_claim_text(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return normalized.strip(" \t\r\n,，.。;；:：!！?？、\"'“”‘’()（）[]【】")


def _proposal_payload_has_conflict_hint(payload: dict[str, Any]) -> bool:
    if str(payload.get("status", "")).lower() == "conflicting":
        return True
    return bool(_payload_int_list(
        payload,
        "conflicting_claim_ids",
        "conflicts_with_claim_ids",
        "conflict_claim_ids",
        "conflict_claim_id",
    ))


async def _proposal_payload_touches_adopted_claim(
    db: AsyncSession,
    topic_id: int,
    payload: dict[str, Any],
    user_id: int,
) -> bool:
    claim_ids = _payload_int_list(
        payload,
        "replaces_claim_id",
        "replace_claim_id",
        "updates_claim_id",
        "update_claim_id",
        "outdated_claim_id",
        "supersedes_claim_id",
    )
    if not claim_ids:
        return False
    result = await db.execute(
        select(func.count(ResearchClaim.id)).where(
            ResearchClaim.id.in_(claim_ids),
            ResearchClaim.topic_id == topic_id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        )
    )
    return int(result.scalar_one()) > 0


async def _topic_has_adopted_claim_with_same_text(
    db: AsyncSession,
    topic_id: int,
    claim_text: str,
    user_id: int,
) -> bool:
    normalized = _normalize_claim_text(claim_text)
    if not normalized:
        return False
    result = await db.execute(
        select(ResearchClaim.claim_text).where(
            ResearchClaim.topic_id == topic_id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        )
    )
    return any(_normalize_claim_text(existing) == normalized for existing in result.scalars().all())


async def _safe_new_claim_proposal_reason(
    db: AsyncSession,
    topic_id: int,
    payload: dict[str, Any],
    user_id: int,
    claim_text: str,
    confidence: int,
    valid_evidence: list[ResearchEvidence],
) -> str:
    if not valid_evidence:
        return "missing_evidence"
    if _proposal_payload_has_conflict_hint(payload):
        return "has_conflict_hint"
    if await _proposal_payload_touches_adopted_claim(db, topic_id, payload, user_id):
        return "touches_adopted_claim"
    if await _topic_has_adopted_claim_with_same_text(db, topic_id, claim_text, user_id):
        return "duplicate_adopted_claim"
    if confidence < AUTO_ADOPT_MIN_CONFIDENCE:
        return "low_confidence"
    return "auto_adopted"


async def _topic_summary(db: AsyncSession, topic: ResearchTopic) -> dict[str, Any]:
    source_count = await _count(db, ResearchSource, ResearchSource.topic_id == topic.id, ResearchSource.user_id == topic.user_id)
    claim_count = await _count(db, ResearchClaim, ResearchClaim.topic_id == topic.id, ResearchClaim.user_id == topic.user_id)
    entity_count = await _count(db, ResearchEntity, ResearchEntity.topic_id == topic.id, ResearchEntity.user_id == topic.user_id)
    conflict_count = await _count(
        db,
        ResearchRelation,
        ResearchRelation.topic_id == topic.id,
        ResearchRelation.user_id == topic.user_id,
        ResearchRelation.relation_type == "conflicts_with",
    )
    return {
        "id": topic.id,
        "title": topic.title,
        "description": topic.description,
        "status": topic.status,
        "summary": topic.summary,
        "last_checked_at": topic.last_checked_at,
        "source_count": source_count,
        "claim_count": claim_count,
        "conflict_count": conflict_count,
        "entity_count": entity_count,
        "created_at": topic.created_at,
        "updated_at": topic.updated_at,
    }


async def _valid_supporting_evidence(
    db: AsyncSession,
    topic_id: int,
    evidence_ids: list[int],
    user_id: int,
) -> list[ResearchEvidence]:
    if not evidence_ids:
        return []
    result = await db.execute(
        select(ResearchEvidence).where(
            ResearchEvidence.id.in_(evidence_ids),
            ResearchEvidence.topic_id == topic_id,
            ResearchEvidence.user_id == user_id,
            ResearchEvidence.quote != "",
            ResearchEvidence.kind.in_(SUPPORTED_EVIDENCE_KINDS),
        )
    )
    return list(result.scalars().all())


async def _claim_has_valid_support(db: AsyncSession, claim: ResearchClaim, user_id: int) -> bool:
    result = await db.execute(
        select(func.count(ResearchEvidence.id))
        .join(
            ResearchRelation,
            (ResearchRelation.from_type == "evidence")
            & (ResearchRelation.from_id == ResearchEvidence.id)
            & (ResearchRelation.to_type == "claim")
            & (ResearchRelation.to_id == claim.id)
            & (ResearchRelation.relation_type == "supports"),
        )
        .where(
            ResearchEvidence.topic_id == claim.topic_id,
            ResearchEvidence.user_id == user_id,
            ResearchEvidence.quote != "",
            ResearchEvidence.kind.in_(SUPPORTED_EVIDENCE_KINDS),
        )
    )
    return int(result.scalar_one()) > 0


def _truncate_detail(text: str, limit: int = 120) -> str:
    s = str(text).strip().replace("\n", " ")
    return s[:limit] + "..." if len(s) > limit else s
