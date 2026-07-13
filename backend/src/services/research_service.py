"""研究图谱业务逻辑。"""

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from langgraph.prebuilt import create_react_agent
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.tools.blog import current_user_id_cv

logger = logging.getLogger(__name__)

from src.database.models import (
    BlogPost,
    BlogPostClaimLink,
    BlogPostResearchLink,
    ResearchClaim,
    ResearchClaimEntityLink,
    ResearchEntity,
    ResearchEvidence,
    ResearchProposal,
    ResearchRelation,
    ResearchRun,
    ResearchSource,
    ResearchTopic,
)

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
COMPLETED_RUN_PROGRESS = {key: "completed" for key in DEFAULT_RUN_PROGRESS}

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


async def create_topic(db: AsyncSession, data: dict[str, Any], user_id: int) -> dict[str, Any]:
    logger.info("创建研究主题 user=%s title=%s", user_id, data.get("title"))
    topic = ResearchTopic(
        user_id=user_id,
        title=data["title"],
        description=data.get("description"),
        status="draft",
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)
    logger.info("研究主题创建成功 id=%s", topic.id)
    return await _topic_summary(db, topic)


async def list_topics(db: AsyncSession, user_id: int) -> list[dict[str, Any]]:
    result = await db.execute(
        select(ResearchTopic)
        .where(ResearchTopic.user_id == user_id, ResearchTopic.status != "archived")
        .order_by(ResearchTopic.updated_at.desc(), ResearchTopic.id.desc())
    )
    topics = result.scalars().all()
    logger.info("列出研究主题 user=%s count=%s", user_id, len(topics))
    return [await _topic_summary(db, topic) for topic in topics]


async def get_topic_detail(db: AsyncSession, topic_id: int, user_id: int) -> dict[str, Any] | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("获取研究主题详情失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    logger.info("获取研究主题详情 topic_id=%s", topic_id)
    summary = await _topic_summary(db, topic)
    queries = {
        "sources": select(ResearchSource).where(ResearchSource.topic_id == topic_id, ResearchSource.user_id == user_id).order_by(ResearchSource.id),
        "evidence": select(ResearchEvidence).where(ResearchEvidence.topic_id == topic_id, ResearchEvidence.user_id == user_id).order_by(ResearchEvidence.id),
        "claims": select(ResearchClaim).where(ResearchClaim.topic_id == topic_id, ResearchClaim.user_id == user_id).order_by(ResearchClaim.id),
        "entities": select(ResearchEntity).where(ResearchEntity.topic_id == topic_id, ResearchEntity.user_id == user_id).order_by(ResearchEntity.id),
        "relations": select(ResearchRelation).where(ResearchRelation.topic_id == topic_id, ResearchRelation.user_id == user_id).order_by(ResearchRelation.id),
        "claim_entity_links": select(ResearchClaimEntityLink).where(
            ResearchClaimEntityLink.topic_id == topic_id,
            ResearchClaimEntityLink.user_id == user_id,
        ).order_by(ResearchClaimEntityLink.id),
        "proposals": select(ResearchProposal).where(ResearchProposal.topic_id == topic_id, ResearchProposal.user_id == user_id).order_by(ResearchProposal.id),
    }
    for key, query in queries.items():
        result = await db.execute(query)
        summary[key] = result.scalars().all()

    entity_ids_by_claim: dict[int, list[int]] = {}
    for link in summary["claim_entity_links"]:
        entity_ids_by_claim.setdefault(link.claim_id, []).append(link.entity_id)
    summary["claims"] = [
        {
            "id": claim.id,
            "topic_id": claim.topic_id,
            "claim_text": claim.claim_text,
            "status": claim.status,
            "confidence": claim.confidence,
            "claim_type": claim.claim_type,
            "adopted": claim.adopted,
            "reasoning": claim.reasoning,
            "entity_ids": entity_ids_by_claim.get(claim.id, []),
            "created_at": claim.created_at,
            "updated_at": claim.updated_at,
        }
        for claim in summary["claims"]
    ]
    return summary


async def update_topic(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> dict[str, Any] | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("更新研究主题失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    logger.info("更新研究主题 topic_id=%s fields=%s", topic_id, [k for k in data])
    for field in ("title", "description", "status", "summary"):
        if field in data:
            setattr(topic, field, data[field])
    await db.commit()
    await db.refresh(topic)
    return await _topic_summary(db, topic)


async def archive_topic(db: AsyncSession, topic_id: int, user_id: int) -> bool:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("归档研究主题失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return False
    logger.info("归档研究主题 topic_id=%s title=%s", topic_id, topic.title)
    topic.status = "archived"
    await db.commit()
    return True


async def delete_topic(db: AsyncSession, topic_id: int, user_id: int) -> bool:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("物理删除研究主题失败：不存在 topic_id=%s user=%s", topic_id, user_id)
        return False
    title = topic.title
    await db.delete(topic)
    await db.commit()
    logger.info("研究主题已物理删除 topic_id=%s title=%s user=%s", topic_id, title, user_id)
    return True


async def _ensure_reviewable_claim_for_run(db: AsyncSession, topic: ResearchTopic, user_id: int) -> None:
    existing_count = await _count(
        db,
        ResearchClaim,
        ResearchClaim.topic_id == topic.id,
        ResearchClaim.user_id == user_id,
    )
    if existing_count > 0:
        return
    subject = topic.title.strip()
    description = (topic.description or "").strip()
    claim_text = f"{subject} 需要结合可验证来源持续审阅后再用于正式写作。"
    if description:
        claim_text = f"{subject} 的研究重点是：{description}"
    db.add(ResearchClaim(
        topic_id=topic.id,
        user_id=user_id,
        claim_text=claim_text,
        status="pending",
        confidence=70,
        claim_type="research_summary",
        adopted=False,
        reasoning="由研究运行生成，等待人工审核。",
    ))


def _build_research_prompt(topic: ResearchTopic) -> str:
    """构建研究 prompt，用 str.replace 避免 str.format 在 title 含特殊字符时崩溃。"""
    title = topic.title or ""
    description = topic.description or "无"
    prompt = RESEARCH_RUN_PROMPT
    prompt = prompt.replace("{title}", title)
    prompt = prompt.replace("{description}", description)
    return prompt


async def _update_run_progress(db: AsyncSession, run_id: int, stage: str, status: str):
    run = await db.get(ResearchRun, run_id)
    if run:
        progress = dict(run.progress_json) if run.progress_json else {}
        progress[stage] = status
        run.progress_json = progress


_STAGE_LOG_MAX = 50


def _truncate_detail(text: str, limit: int = 120) -> str:
    s = str(text).strip().replace("\n", " ")
    return s[:limit] + "..." if len(s) > limit else s


_TOOL_ACTION_MAP = {
    "research_create_topic": "创建研究主题",
    "research_get_topic": "查看研究主题",
    "research_add_source": "添加来源",
    "research_add_evidence": "添加证据",
    "research_add_entity": "添加实体",
    "research_add_claim": "提取事实",
    "research_add_relation": "建立关系",
    "research_add_proposal": "生成提案",
}


async def _append_stage_log(db: AsyncSession, run_id: int, stage: str, entry: dict[str, Any]):
    run = await db.get(ResearchRun, run_id)
    if not run:
        return
    progress = dict(run.progress_json) if run.progress_json else {}
    log_key = f"{stage}_log"
    logs: list[dict[str, Any]] = list(progress.get(log_key) or [])
    logs.append(entry)
    if len(logs) > _STAGE_LOG_MAX:
        logs = logs[-_STAGE_LOG_MAX:]
    progress[log_key] = logs
    run.progress_json = progress


async def _count_stage_output(db: AsyncSession, stage: str, topic_id: int, user_id: int) -> int:
    """统计某个阶段在当前 topic 下的产出数量。"""
    stage_counts = {
        "search_sources": (ResearchSource, [ResearchSource.topic_id == topic_id, ResearchSource.user_id == user_id]),
        "fetch_pages": (ResearchEvidence, [ResearchEvidence.topic_id == topic_id, ResearchEvidence.user_id == user_id]),
        "extract_claims": (ResearchClaim, [ResearchClaim.topic_id == topic_id, ResearchClaim.user_id == user_id]),
        "detect_conflicts": (ResearchRelation, [
            ResearchRelation.topic_id == topic_id,
            ResearchRelation.user_id == user_id,
            ResearchRelation.relation_type == "conflicts_with",
        ]),
    }
    if stage not in stage_counts:
        return 0
    model, filters = stage_counts[stage]
    return await _count(db, model, *filters)


async def _run_agent_stage(db: AsyncSession, run_id: int, topic_id: int, user_id: int,
                           stage: str, instruction: str) -> bool:
    """返回 False 仅在 agent 抛异常/超时，或全程零工具调用且零产出；零产出但有过工具调用视为 completed。"""
    from src.services.chat_service import _chat_model_kwargs, _create_llm
    from src.services.llm_settings_service import get_user_llm_settings, has_usable_api_key
    from src.tools.research import RESEARCH_TOOLS

    topic = await db.get(ResearchTopic, topic_id)
    if not topic:
        return False

    prompt = _build_research_prompt(topic)

    user_llm_settings = await get_user_llm_settings(db, user_id)
    model_kwargs = _chat_model_kwargs("balanced", user_llm_settings)
    if not has_usable_api_key(model_kwargs):
        raise RuntimeError("未配置 API 密钥，请先在「设置」页填写你自己的 API 密钥再启动研究。")
    llm = _create_llm(model_kwargs, "balanced")
    agent = create_react_agent(llm, list(RESEARCH_TOOLS), prompt=prompt)

    before_count = await _count_stage_output(db, stage, topic_id, user_id)

    token = current_user_id_cv.set(user_id)
    tool_call_count = 0
    try:
        messages = [{"role": "user", "content": instruction}]
        _tool_start_times: dict[str, datetime] = {}
        async with asyncio.timeout(180):
            async for event in agent.astream_events(
                {"messages": messages},
                version="v2",
                config={"recursion_limit": 30},
            ):
                kind = event.get("event", "")

                if kind == "on_tool_start":
                    tool_name = event.get("name", "")
                    tool_input = event.get("data", {}).get("input", {})
                    logger.info("Research stage %s tool start: %s", stage, tool_name)
                    action = _TOOL_ACTION_MAP.get(tool_name, tool_name)
                    _tool_start_times[event["run_id"]] = datetime.now(timezone.utc).replace(tzinfo=None)
                    tool_call_count += 1
                    detail_parts = []
                    if isinstance(tool_input, dict):
                        LONG_FIELDS = {"payload", "quote", "claim_text", "content", "description", "reasoning"}
                        for key, val in tool_input.items():
                            if val is None or val == "":
                                continue
                            text = str(val)
                            if key in LONG_FIELDS:
                                text = _truncate_detail(text, 60)
                            detail_parts.append(f"{key}={text}")
                    detail = " | ".join(detail_parts) if detail_parts else ""
                    entry = {
                        "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
                        "type": "tool",
                        "tool": tool_name,
                        "action": action,
                        "detail": detail,
                        "status": "running",
                    }
                    await _append_stage_log(db, run_id, stage, entry)
                    await db.commit()

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    output = str(event.get("data", {}).get("output", ""))
                    logger.info("Research stage %s tool end: %s result=%s", stage, tool_name, output[:200])
                    action = _TOOL_ACTION_MAP.get(tool_name, tool_name)
                    detail = _truncate_detail(output.split("\n")[0]) if output else ""
                    status = "error" if output.startswith("错误") or output.startswith("警告") else "ok"
                    start_time = _tool_start_times.pop(event["run_id"], None)
                    entry = {
                        "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
                        "type": "tool",
                        "tool": tool_name,
                        "action": action,
                        "detail": detail,
                        "status": status,
                    }
                    if start_time:
                        entry["duration"] = round((datetime.now(timezone.utc).replace(tzinfo=None) - start_time).total_seconds(), 1)
                    await _append_stage_log(db, run_id, stage, entry)
                    await db.commit()

                elif kind == "on_tool_error":
                    tool_name = event.get("name", "")
                    error_msg = str(event.get("data", {}).get("error", ""))[:200]
                    logger.info("Research stage %s tool error: %s error=%s", stage, tool_name, error_msg)
                    start_time = _tool_start_times.pop(event["run_id"], None)
                    entry = {
                        "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
                        "type": "tool",
                        "tool": tool_name,
                        "action": _TOOL_ACTION_MAP.get(tool_name, tool_name),
                        "detail": error_msg,
                        "status": "error",
                    }
                    if start_time:
                        entry["duration"] = round((datetime.now(timezone.utc).replace(tzinfo=None) - start_time).total_seconds(), 1)
                    await _append_stage_log(db, run_id, stage, entry)
                    await db.commit()

                elif kind == "on_chat_model_end":
                    ai_msg = event.get("data", {}).get("output")
                    if hasattr(ai_msg, "content") and isinstance(ai_msg.content, str) and ai_msg.content:
                        content_preview = _truncate_detail(str(ai_msg.content), 80)
                        if content_preview:
                            entry = {
                                "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds"),
                                "type": "thinking",
                                "tool": "",
                                "action": "思考",
                                "detail": content_preview,
                                "status": "info",
                            }
                            await _append_stage_log(db, run_id, stage, entry)
                            await db.commit()
    except asyncio.TimeoutError:
        logger.warning("Research stage %s timed out after 180s", stage)
        await _update_run_progress(db, run_id, stage, "failed")
        await db.commit()
        return False
    except Exception as e:
        logger.exception("Research stage %s error: %s", stage, e)
        await _update_run_progress(db, run_id, stage, "failed")
        await db.commit()
        return False
    finally:
        current_user_id_cv.reset(token)

    after_count = await _count_stage_output(db, stage, topic_id, user_id)
    has_output = after_count > before_count
    logger.info(
        "Research stage %s done: output count %d -> %d, tool_calls=%d",
        stage, before_count, after_count, tool_call_count,
    )

    if not has_output and tool_call_count == 0:
        logger.warning("Research stage %s produced no output and no tool calls", stage)
        await _update_run_progress(db, run_id, stage, "failed")
        await db.commit()
        return False

    if not has_output:
        logger.info(
            "Research stage %s produced no rows for its primary table but ran %d tool call(s); treating as completed",
            stage, tool_call_count,
        )

    return True


async def _execute_research_run(run_id: int, topic_id: int, user_id: int):
    from src.database.engine import async_session as session_factory

    _STAGES = [
        ("search_sources", "请搜索与主题相关的信息源，使用 research_add_source 保存找到的每个来源。"),
        ("fetch_pages", "请使用 MCP 工具抓取已有来源的页面内容，使用 research_add_evidence 保存原文证据片段。"),
        ("extract_claims", "请基于已有证据提取事实声明，使用 research_add_claim 保存每条 Claim 并关联 evidence_ids。"),
        ("detect_conflicts", "请检查已有 Claim 之间是否存在矛盾，使用 research_add_relation 标记 conflicts_with 关系。"),
    ]

    async with session_factory() as db:
        try:
            stage_failed = False
            for stage_name, instruction in _STAGES:
                await _update_run_progress(db, run_id, stage_name, "running")
                await db.commit()
                ok = await _run_agent_stage(db, run_id, topic_id, user_id, stage_name, instruction)
                if ok:
                    await _update_run_progress(db, run_id, stage_name, "completed")
                    await db.commit()
                else:
                    stage_failed = True
                    break  # 阶段抛异常、超时或全程零工具调用零产出，跳过后续阶段

            run = await db.get(ResearchRun, run_id)
            if stage_failed:
                if run:
                    run.status = "failed"
                    run.error_message = "研究阶段执行异常或无任何工具调用与产出"
                    run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            else:
                await _update_run_progress(db, run_id, "await_review", "completed")
                if run:
                    run.status = "completed"
                    run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                topic = await db.get(ResearchTopic, topic_id)
                if topic:
                    topic.status = "reviewing"
                    topic.last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await db.commit()

        except Exception as e:
            logger.exception("研究执行失败 run_id=%s", run_id)
            async with session_factory() as fail_db:
                run = await fail_db.get(ResearchRun, run_id)
                if run:
                    run.status = "failed"
                    run.error_message = str(e)[:1000]
                    run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                await fail_db.commit()


async def create_research_run(
    db: AsyncSession,
    topic_id: int,
    user_id: int,
    idempotency_key: str | None = None,
) -> ResearchRun | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("创建研究 run 失败：主题不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    key = idempotency_key or str(uuid4())
    existing = await db.execute(
        select(ResearchRun).where(
            ResearchRun.topic_id == topic_id,
            ResearchRun.user_id == user_id,
            ResearchRun.idempotency_key == key,
        )
    )
    run = existing.scalar_one_or_none()
    if run:
        if run.status == "running":
            logger.info("研究 run 幂等复用 topic_id=%s run_id=%s", topic_id, run.id)
            return run
        # 非 running 状态（failed/completed）的 run 腾出 idempotency_key 以允许同 key 重试
        run.idempotency_key = f"{key}__{run.id}_{int(datetime.now(timezone.utc).replace(tzinfo=None).timestamp())}"
        await db.flush()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    run = ResearchRun(
        topic_id=topic_id,
        user_id=user_id,
        idempotency_key=key,
        status="running",
        started_at=now,
        progress_json=DEFAULT_RUN_PROGRESS.copy(),
    )
    db.add(run)
    created_new = True
    try:
        with db.no_autoflush:
            await _ensure_reviewable_claim_for_run(db, topic, user_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        db.expunge_all()
        rival = await db.execute(
            select(ResearchRun).where(
                ResearchRun.topic_id == topic_id,
                ResearchRun.user_id == user_id,
                ResearchRun.idempotency_key == key,
            )
        )
        run = rival.scalar_one_or_none()
        if run is None:
            raise
        logger.info("并发重试幂等复用 topic_id=%s run_id=%s", topic_id, run.id)
        created_new = False
    if run.id is None:
        await db.flush()
    result = await db.execute(
        select(ResearchRun).where(ResearchRun.id == run.id)
    )
    run = result.scalar_one()
    logger.info("研究 run 已创建 run_id=%s topic_id=%s user=%s", run.id, topic_id, user_id)
    if created_new:
        asyncio.create_task(_execute_research_run(run.id, topic_id, user_id))
    return run


async def list_research_runs(db: AsyncSession, topic_id: int, user_id: int) -> list[dict[str, Any]] | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        return None
    result = await db.execute(
        select(ResearchRun)
        .where(ResearchRun.topic_id == topic_id, ResearchRun.user_id == user_id)
        .order_by(ResearchRun.created_at.desc(), ResearchRun.id.desc())
    )
    return [run_response(run) for run in result.scalars().all()]


async def generate_draft_preview(db: AsyncSession, topic_id: int, user_id: int) -> dict[str, Any] | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        return None
    claim_result = await db.execute(
        select(ResearchClaim)
        .where(
            ResearchClaim.topic_id == topic_id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        )
        .order_by(ResearchClaim.confidence.desc(), ResearchClaim.id)
    )
    claims = claim_result.scalars().all()
    outline = ["研究背景", "关键事实", "写作建议"]
    if claims:
        outline = ["研究背景", *[claim.claim_text for claim in claims], "写作建议"]
    claim_lines = [f"- {claim.claim_text}" for claim in claims]
    if not claim_lines:
        claim_lines = ["- 当前还没有已采用事实，请先审核并采用研究事实。"]
    content = "\n\n".join([
        f"# {topic.title}",
        topic.description or "基于当前研究主题生成的文章草稿预览。",
        "## 关键事实\n" + "\n".join(claim_lines),
        "## 写作建议\n围绕已采用事实展开论证，并在发布前补充可验证引用。",
    ])
    return {
        "title": topic.title,
        "outline": outline,
        "content": content,
        "references": [],
    }


async def _find_entity_by_name(db: AsyncSession, topic_id: int, name: str, user_id: int) -> ResearchEntity | None:
    normalized = _normalize_entity_name(name).lower()
    if not normalized:
        return None
    result = await db.execute(
        select(ResearchEntity).where(
            ResearchEntity.topic_id == topic_id,
            ResearchEntity.user_id == user_id,
        )
    )
    for entity in result.scalars().all():
        if _normalize_entity_name(entity.name).lower() == normalized:
            return entity
    return None


async def create_entity(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> ResearchEntity | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("创建实体失败：主题不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    name = _normalize_entity_name(str(data.get("name", "")))
    if not name:
        raise ValueError("Entity name is required")

    entity_type = str(data.get("entity_type") or "other")
    if entity_type not in ENTITY_TYPES:
        entity_type = "other"
    status = str(data.get("status") or "active")
    if status not in ENTITY_STATUSES:
        status = "active"
    aliases = _coerce_str_list(data.get("aliases"))
    existing = await _find_entity_by_name(db, topic_id, name, user_id)
    if existing:
        description = data.get("description")
        if description:
            existing.description = str(description)
        confidence = _clamp_confidence(data.get("confidence"))
        if confidence > existing.confidence:
            existing.confidence = confidence
        if aliases:
            existing_aliases = _coerce_str_list(existing.aliases_json)
            existing.aliases_json = existing_aliases + [alias for alias in aliases if alias not in existing_aliases]
        if not existing.entity_type or existing.entity_type == "other":
            existing.entity_type = entity_type
        existing.status = status
        await db.commit()
        await db.refresh(existing)
        return existing

    entity = ResearchEntity(
        topic_id=topic_id,
        user_id=user_id,
        name=name,
        entity_type=entity_type,
        description=data.get("description"),
        aliases_json=aliases,
        confidence=_clamp_confidence(data.get("confidence")),
        status=status,
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    logger.info("实体创建成功 entity_id=%s topic_id=%s", entity.id, topic_id)
    return entity


async def list_entities(db: AsyncSession, topic_id: int, user_id: int) -> list[ResearchEntity] | None:
    if not await _get_owned_topic(db, topic_id, user_id):
        return None
    result = await db.execute(
        select(ResearchEntity)
        .where(ResearchEntity.topic_id == topic_id, ResearchEntity.user_id == user_id)
        .order_by(ResearchEntity.id)
    )
    return list(result.scalars().all())


async def get_entity_detail(db: AsyncSession, entity_id: int, user_id: int) -> ResearchEntity | None:
    result = await db.execute(select(ResearchEntity).where(ResearchEntity.id == entity_id, ResearchEntity.user_id == user_id))
    return result.scalar_one_or_none()


async def update_entity(db: AsyncSession, entity_id: int, data: dict[str, Any], user_id: int) -> ResearchEntity | None:
    entity = await get_entity_detail(db, entity_id, user_id)
    if not entity:
        return None
    if "name" in data and data["name"] is not None:
        name = _normalize_entity_name(str(data["name"]))
        if not name:
            raise ValueError("Entity name is required")
        duplicate = await _find_entity_by_name(db, entity.topic_id, name, user_id)
        if duplicate and duplicate.id != entity.id:
            raise ValueError("Entity already exists in this topic")
        entity.name = name
    if "entity_type" in data and data["entity_type"] is not None:
        entity_type = str(data["entity_type"])
        entity.entity_type = entity_type if entity_type in ENTITY_TYPES else "other"
    if "description" in data:
        entity.description = data["description"]
    if "confidence" in data and data["confidence"] is not None:
        entity.confidence = _clamp_confidence(data["confidence"])
    if "status" in data and data["status"] is not None:
        status = str(data["status"])
        entity.status = status if status in ENTITY_STATUSES else "active"
    if "aliases" in data and data["aliases"] is not None:
        entity.aliases_json = _coerce_str_list(data["aliases"])
    await db.commit()
    await db.refresh(entity)
    return entity


async def delete_entity(db: AsyncSession, entity_id: int, user_id: int) -> bool:
    entity = await get_entity_detail(db, entity_id, user_id)
    if not entity:
        return False
    await db.execute(
        delete(ResearchClaimEntityLink).where(
            ResearchClaimEntityLink.entity_id == entity_id,
            ResearchClaimEntityLink.user_id == user_id,
        )
    )
    await db.execute(
        delete(ResearchRelation).where(
            ResearchRelation.topic_id == entity.topic_id,
            ResearchRelation.user_id == user_id,
            ((ResearchRelation.from_type == "entity") & (ResearchRelation.from_id == entity_id))
            | ((ResearchRelation.to_type == "entity") & (ResearchRelation.to_id == entity_id)),
        )
    )
    await db.delete(entity)
    await db.commit()
    return True


async def get_or_create_entity(
    db: AsyncSession,
    topic_id: int,
    name: str,
    user_id: int,
    entity_type: str = "claim_subject",
) -> ResearchEntity | None:
    normalized = _normalize_entity_name(name)
    if not normalized:
        return None
    existing = await _find_entity_by_name(db, topic_id, normalized, user_id)
    if existing:
        return existing
    return await create_entity(db, topic_id, {"name": normalized, "entity_type": entity_type}, user_id)


async def link_claim_entities(
    db: AsyncSession,
    claim_id: int,
    entity_ids: list[int],
    topic_id: int,
    user_id: int,
    role: str = "mentioned",
) -> list[int]:
    linked_ids: list[int] = []
    for entity_id in entity_ids:
        if entity_id in linked_ids:
            continue
        entity = await db.get(ResearchEntity, entity_id)
        if not entity or entity.topic_id != topic_id or entity.user_id != user_id:
            continue
        existing_link = await db.execute(
            select(ResearchClaimEntityLink).where(
                ResearchClaimEntityLink.claim_id == claim_id,
                ResearchClaimEntityLink.entity_id == entity_id,
                ResearchClaimEntityLink.user_id == user_id,
            )
        )
        if not existing_link.scalar_one_or_none():
            db.add(ResearchClaimEntityLink(
                claim_id=claim_id,
                entity_id=entity_id,
                topic_id=topic_id,
                user_id=user_id,
                role=role,
            ))
        existing_relation = await db.execute(
            select(ResearchRelation).where(
                ResearchRelation.topic_id == topic_id,
                ResearchRelation.user_id == user_id,
                ResearchRelation.from_type == "claim",
                ResearchRelation.from_id == claim_id,
                ResearchRelation.to_type == "entity",
                ResearchRelation.to_id == entity_id,
                ResearchRelation.relation_type == "mentions",
            )
        )
        if not existing_relation.scalar_one_or_none():
            db.add(ResearchRelation(
                topic_id=topic_id,
                user_id=user_id,
                from_type="claim",
                from_id=claim_id,
                to_type="entity",
                to_id=entity_id,
                relation_type="mentions",
            ))
        linked_ids.append(entity_id)
    return linked_ids


async def _owned_research_node_exists(
    db: AsyncSession,
    node_type: str,
    node_id: int,
    topic_id: int,
    user_id: int,
) -> bool:
    model_by_type = {
        "source": ResearchSource,
        "evidence": ResearchEvidence,
        "claim": ResearchClaim,
        "entity": ResearchEntity,
    }
    model = model_by_type.get(node_type)
    if not model:
        return False
    item = await db.get(model, node_id)
    return bool(item and item.topic_id == topic_id and item.user_id == user_id)


async def create_relation(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> ResearchRelation | None:
    if not await _get_owned_topic(db, topic_id, user_id):
        return None
    from_type = str(data.get("from_type") or "").strip()
    to_type = str(data.get("to_type") or "").strip()
    relation_type = str(data.get("relation_type") or "related_to").strip()
    from_id = _coerce_int(data.get("from_id"))
    to_id = _coerce_int(data.get("to_id"))
    if from_type not in VALID_RELATION_NODE_TYPES or to_type not in VALID_RELATION_NODE_TYPES:
        raise ValueError("Relation node type must be source, evidence, claim, or entity")
    if relation_type not in VALID_RELATION_TYPES:
        raise ValueError("Unsupported relation type")
    if not await _owned_research_node_exists(db, from_type, from_id, topic_id, user_id):
        raise ValueError("Relation source node not found")
    if not await _owned_research_node_exists(db, to_type, to_id, topic_id, user_id):
        raise ValueError("Relation target node not found")
    existing = await db.execute(
        select(ResearchRelation).where(
            ResearchRelation.topic_id == topic_id,
            ResearchRelation.user_id == user_id,
            ResearchRelation.from_type == from_type,
            ResearchRelation.from_id == from_id,
            ResearchRelation.to_type == to_type,
            ResearchRelation.to_id == to_id,
            ResearchRelation.relation_type == relation_type,
        )
    )
    relation = existing.scalar_one_or_none()
    if relation:
        return relation
    relation = ResearchRelation(
        topic_id=topic_id,
        user_id=user_id,
        from_type=from_type,
        from_id=from_id,
        to_type=to_type,
        to_id=to_id,
        relation_type=relation_type,
        metadata_json=data.get("metadata") or data.get("metadata_json"),
    )
    db.add(relation)
    await db.commit()
    await db.refresh(relation)
    return relation


async def create_claim(db: AsyncSession, topic_id: int, data: dict[str, Any], user_id: int) -> ResearchClaim | None:
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not topic:
        logger.warning("创建 Claim 失败：主题不存在 topic_id=%s user=%s", topic_id, user_id)
        return None
    status = data.get("status") or "pending"
    evidence_ids = data.get("evidence_ids") or []
    requested_entity_ids = [entity_id for entity_id in data.get("entity_ids", []) if isinstance(entity_id, int)]
    for entity_name in _coerce_str_list(data.get("entity_names")):
        entity = await get_or_create_entity(db, topic_id, entity_name, user_id)
        if entity and entity.id not in requested_entity_ids:
            requested_entity_ids.append(entity.id)
    logger.info("创建 Claim topic_id=%s status=%s evidence_count=%s entity_count=%s user=%s", topic_id, status, len(evidence_ids), len(requested_entity_ids), user_id)
    valid_evidence = await _valid_supporting_evidence(db, topic_id, evidence_ids, user_id)
    if status == "supported" and not valid_evidence:
        logger.warning("创建 Claim 被拒：缺少有效证据 topic_id=%s", topic_id)
        raise ValueError("Evidence is required before a Claim can be supported")
    claim = ResearchClaim(
        topic_id=topic_id,
        user_id=user_id,
        claim_text=data["claim_text"],
        status=status,
        confidence=data.get("confidence", 0),
        claim_type=data.get("claim_type"),
        adopted=bool(data.get("adopted", False)),
        reasoning=data.get("reasoning"),
    )
    db.add(claim)
    await db.flush()
    for evidence in valid_evidence:
        db.add(ResearchRelation(
            topic_id=topic_id,
            user_id=user_id,
            from_type="evidence",
            from_id=evidence.id,
            to_type="claim",
            to_id=claim.id,
            relation_type="supports",
        ))
    linked_entity_ids = await link_claim_entities(db, claim.id, requested_entity_ids, topic_id, user_id)
    await db.commit()
    await db.refresh(claim)
    claim.entity_ids = linked_entity_ids
    logger.info("Claim 创建成功 claim_id=%s topic_id=%s entity_count=%s", claim.id, topic_id, len(linked_entity_ids))
    return claim


async def update_claim(db: AsyncSession, claim_id: int, data: dict[str, Any], user_id: int) -> ResearchClaim | None:
    result = await db.execute(select(ResearchClaim).where(ResearchClaim.id == claim_id, ResearchClaim.user_id == user_id))
    claim = result.scalar_one_or_none()
    if not claim:
        logger.warning("更新 Claim 失败：不存在 claim_id=%s user=%s", claim_id, user_id)
        return None
    logger.info("更新 Claim claim_id=%s fields=%s", claim_id, [k for k in data])
    evidence_ids = data.get("evidence_ids")
    if data.get("status") == "supported":
        valid_evidence = await _valid_supporting_evidence(db, claim.topic_id, evidence_ids or [], user_id)
        if not valid_evidence and not await _claim_has_valid_support(db, claim, user_id):
            raise ValueError("Evidence is required before a Claim can be supported")
    for field in ("status", "confidence", "adopted", "reasoning"):
        if field in data:
            setattr(claim, field, data[field])
    await db.commit()
    await db.refresh(claim)
    return claim


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


async def _apply_conflict_resolution(
    db: AsyncSession,
    rel: ResearchRelation,
    accepted_claim_id: int,
    rejected_claim_id: int,
    user_id: int,
) -> ResearchRelation:
    if rel.relation_type != "conflicts_with" or rel.from_type != "claim" or rel.to_type != "claim":
        raise ValueError("Only claim conflicts can be resolved")

    relation_claim_ids = {int(rel.from_id), int(rel.to_id)}
    requested_claim_ids = {int(accepted_claim_id), int(rejected_claim_id)}
    if len(requested_claim_ids) != 2 or requested_claim_ids != relation_claim_ids:
        raise ValueError("Accepted and rejected claims must match the conflict relation")

    accepted_claim = await db.get(ResearchClaim, int(accepted_claim_id))
    rejected_claim = await db.get(ResearchClaim, int(rejected_claim_id))
    if not accepted_claim or not rejected_claim:
        raise ValueError("Conflict claims not found")
    if accepted_claim.user_id != user_id or rejected_claim.user_id != user_id:
        raise ValueError("Conflict claims not found")
    if accepted_claim.topic_id != rel.topic_id or rejected_claim.topic_id != rel.topic_id:
        raise ValueError("Conflict claims must belong to the same topic")

    if not await _claim_has_valid_support(db, accepted_claim, user_id):
        raise ValueError("Evidence is required before accepting a claim")

    accepted_claim.status = "supported"
    accepted_claim.adopted = True
    rejected_claim.status = "rejected"
    rejected_claim.adopted = False
    rel.metadata_json = {
        **(rel.metadata_json or {}),
        "resolution": "accepted_rejected",
        "accepted_claim_id": accepted_claim.id,
        "rejected_claim_id": rejected_claim.id,
        "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "resolved_by": user_id,
    }
    await db.commit()
    await db.refresh(rel)
    return rel


async def resolve_conflict(
    db: AsyncSession,
    relation_id: int,
    data: dict[str, Any],
    user_id: int,
) -> ResearchRelation | None:
    rel = await db.get(ResearchRelation, relation_id)
    if not rel or rel.user_id != user_id:
        return None
    try:
        accepted_claim_id = int(data.get("accepted_claim_id"))
        rejected_claim_id = int(data.get("rejected_claim_id"))
    except (TypeError, ValueError):
        raise ValueError("Accepted and rejected claim ids are required")
    return await _apply_conflict_resolution(db, rel, accepted_claim_id, rejected_claim_id, user_id)


async def attach_topic_to_post(db: AsyncSession, post_id: int, topic_id: int, user_id: int) -> dict[str, Any] | None:
    post = await _get_owned_post(db, post_id, user_id)
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not post or not topic:
        logger.warning("关联研究主题到文章失败 post_id=%s topic_id=%s user=%s", post_id, topic_id, user_id)
        return None
    logger.info("关联研究主题到文章 post_id=%s topic_id=%s", post_id, topic_id)
    result = await db.execute(
        select(BlogPostResearchLink).where(
            BlogPostResearchLink.post_id == post_id,
            BlogPostResearchLink.topic_id == topic_id,
            BlogPostResearchLink.user_id == user_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return _link_response(existing)
    link = BlogPostResearchLink(
        post_id=post_id,
        topic_id=topic_id,
        user_id=user_id,
        snapshot_json=await _build_post_snapshot(db, topic, user_id),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _link_response(link)


async def get_blog_research_summary(db: AsyncSession, post_id: int, user_id: int) -> dict[str, Any] | None:
    post = await _get_owned_post(db, post_id, user_id)
    if not post:
        logger.warning("获取博客研究摘要失败：文章不存在 post_id=%s user=%s", post_id, user_id)
        return None
    logger.info("获取博客研究摘要 post_id=%s", post_id)
    result = await db.execute(
        select(BlogPostResearchLink).where(BlogPostResearchLink.post_id == post_id, BlogPostResearchLink.user_id == user_id)
    )
    links = result.scalars().all()
    claim_result = await db.execute(
        select(BlogPostClaimLink, ResearchClaim)
        .join(ResearchClaim, ResearchClaim.id == BlogPostClaimLink.claim_id)
        .where(BlogPostClaimLink.post_id == post_id, BlogPostClaimLink.user_id == user_id)
    )
    claims = [
        {
            "id": claim.id,
            "topic_id": claim.topic_id,
            "claim_text": claim.claim_text,
            "status": claim.status,
            "confidence": claim.confidence,
            "usage_note": link.usage_note,
        }
        for link, claim in claim_result.all()
    ]
    return {
        "post_id": post_id,
        "topics": [link.snapshot_json.get("topic", {"id": link.topic_id}) for link in links],
        "claims": claims,
    }


async def _build_post_snapshot(db: AsyncSession, topic: ResearchTopic, user_id: int) -> dict[str, Any]:
    result = await db.execute(
        select(ResearchClaim).where(
            ResearchClaim.topic_id == topic.id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        )
    )
    claims = result.scalars().all()

    claim_snapshots: list[dict[str, Any]] = []
    for claim in claims:
        # 查找 supporting evidence
        ev_result = await db.execute(
            select(ResearchEvidence, ResearchRelation)
            .join(
                ResearchRelation,
                (ResearchRelation.from_type == "evidence")
                & (ResearchRelation.from_id == ResearchEvidence.id)
                & (ResearchRelation.to_type == "claim")
                & (ResearchRelation.to_id == claim.id)
                & (ResearchRelation.relation_type == "supports"),
            )
            .where(
                ResearchEvidence.topic_id == topic.id,
                ResearchEvidence.user_id == user_id,
            )
        )
        evidence_snapshots: list[dict[str, Any]] = []
        for ev, _rel in ev_result.all():
            source_snapshot = None
            if ev.source_id:
                src = await db.get(ResearchSource, ev.source_id)
                if src and src.user_id == user_id:
                    source_snapshot = {
                        "id": src.id,
                        "title": src.title,
                        "url": src.url,
                        "publisher": src.publisher,
                        "source_type": src.source_type,
                        "published_at": src.published_at.isoformat() if src.published_at else None,
                        "trust_level": src.trust_level,
                    }
            evidence_snapshots.append({
                "id": ev.id,
                "quote": ev.quote,
                "location": ev.location,
                "kind": ev.kind,
                "source": source_snapshot,
            })

        claim_snapshots.append({
            "id": claim.id,
            "claim_text": claim.claim_text,
            "status": claim.status,
            "confidence": claim.confidence,
            "evidence": evidence_snapshots,
        })

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "topic": {
            "id": topic.id,
            "title": topic.title,
            "status": topic.status,
        },
        "claims": claim_snapshots,
    }


def _link_response(link: BlogPostResearchLink) -> dict[str, Any]:
    return {
        "id": link.id,
        "post_id": link.post_id,
        "topic_id": link.topic_id,
        "snapshot": link.snapshot_json,
        "created_at": link.created_at,
    }


def run_response(run: ResearchRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "topic_id": run.topic_id,
        "status": run.status,
        "progress": run.progress_json or {},
        "error_message": run.error_message,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


async def detach_topic_from_post(db: AsyncSession, post_id: int, topic_id: int, user_id: int) -> bool:
    """从博客文章移除研究主题关联。"""
    post = await _get_owned_post(db, post_id, user_id)
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not post or not topic:
        logger.warning("解除研究主题关联失败 post_id=%s topic_id=%s user=%s", post_id, topic_id, user_id)
        return False
    result = await db.execute(
        select(BlogPostResearchLink).where(
            BlogPostResearchLink.post_id == post_id,
            BlogPostResearchLink.topic_id == topic_id,
            BlogPostResearchLink.user_id == user_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        return False
    await db.delete(link)
    await db.commit()
    logger.info("解除研究主题关联 post_id=%s topic_id=%s", post_id, topic_id)
    return True


async def attach_claim_to_post(db: AsyncSession, post_id: int, claim_id: int, user_id: int, usage_note: str = "") -> dict[str, Any] | None:
    """将一条 Claim 采用到博客文章中。校验 post 和 claim 归属。"""
    post = await _get_owned_post(db, post_id, user_id)
    if not post:
        logger.warning("采用 Claim 失败：文章不存在 post_id=%s user=%s", post_id, user_id)
        return None
    claim_result = await db.execute(
        select(ResearchClaim).where(ResearchClaim.id == claim_id, ResearchClaim.user_id == user_id)
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        logger.warning("采用 Claim 失败：claim 不存在 claim_id=%s user=%s", claim_id, user_id)
        return None
    logger.info("采用 Claim 到文章 post_id=%s claim_id=%s", post_id, claim_id)
    existing = await db.execute(
        select(BlogPostClaimLink).where(
            BlogPostClaimLink.post_id == post_id,
            BlogPostClaimLink.claim_id == claim_id,
            BlogPostClaimLink.user_id == user_id,
        )
    )
    link = existing.scalar_one_or_none()
    if link:
        return {"id": link.id, "post_id": link.post_id, "claim_id": link.claim_id, "topic_id": link.topic_id, "usage_note": link.usage_note, "created_at": link.created_at}
    link = BlogPostClaimLink(
        post_id=post_id,
        claim_id=claim_id,
        topic_id=claim.topic_id,
        user_id=user_id,
        usage_note=usage_note.strip() or None,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return {"id": link.id, "post_id": link.post_id, "claim_id": link.claim_id, "topic_id": link.topic_id, "usage_note": link.usage_note, "created_at": link.created_at}


async def attach_adopted_claims_for_topic_to_post(
    db: AsyncSession,
    post_id: int,
    topic_id: int,
    user_id: int,
    usage_note: str = "",
) -> int:
    post = await _get_owned_post(db, post_id, user_id)
    topic = await _get_owned_topic(db, topic_id, user_id)
    if not post or not topic:
        logger.warning("自动采用主题事实失败 post_id=%s topic_id=%s user=%s", post_id, topic_id, user_id)
        return 0

    claim_result = await db.execute(
        select(ResearchClaim).where(
            ResearchClaim.topic_id == topic_id,
            ResearchClaim.user_id == user_id,
            ResearchClaim.adopted.is_(True),
        ).order_by(ResearchClaim.id)
    )
    claims = claim_result.scalars().all()
    if not claims:
        return 0

    existing_result = await db.execute(
        select(BlogPostClaimLink.claim_id).where(
            BlogPostClaimLink.post_id == post_id,
            BlogPostClaimLink.user_id == user_id,
            BlogPostClaimLink.claim_id.in_([claim.id for claim in claims]),
        )
    )
    existing_claim_ids = set(existing_result.scalars().all())

    linked_count = 0
    for claim in claims:
        if claim.id in existing_claim_ids:
            continue
        linked = await attach_claim_to_post(db, post_id, claim.id, user_id, usage_note)
        if linked:
            linked_count += 1

    logger.info("自动采用主题事实完成 post_id=%s topic_id=%s linked=%s", post_id, topic_id, linked_count)
    return linked_count


async def detach_claim_from_post(db: AsyncSession, post_id: int, claim_id: int, user_id: int) -> bool:
    """从博客文章移除已采用的 Claim。"""
    post = await _get_owned_post(db, post_id, user_id)
    if not post:
        logger.warning("移除 Claim 失败：文章不存在 post_id=%s user=%s", post_id, user_id)
        return False
    logger.info("移除已采用 Claim post_id=%s claim_id=%s", post_id, claim_id)
    result = await db.execute(
        select(BlogPostClaimLink).where(
            BlogPostClaimLink.post_id == post_id,
            BlogPostClaimLink.claim_id == claim_id,
            BlogPostClaimLink.user_id == user_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        return False
    await db.delete(link)
    await db.commit()
    return True


async def update_proposal(db: AsyncSession, proposal_id: int, data: dict[str, Any], user_id: int) -> ResearchProposal | None:
    """审核提案：批准、拒绝或标记已应用。"""
    result = await db.execute(
        select(ResearchProposal).where(ResearchProposal.id == proposal_id, ResearchProposal.user_id == user_id)
    )
    proposal = result.scalar_one_or_none()
    if not proposal:
        logger.warning("审核提案失败：不存在 proposal_id=%s user=%s", proposal_id, user_id)
        return None

    new_status = data.get("status")
    if new_status and new_status in ("approved", "rejected", "applied", "pending"):
        proposal.status = new_status
        if new_status in ("approved", "rejected"):
            proposal.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        if new_status == "applied":
            proposal.applied_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(proposal)
    logger.info("提案审核完成 proposal_id=%s status=%s", proposal_id, proposal.status)

    # 如果是 applied，执行提案的 payload
    if proposal.status == "applied" and proposal.payload_json:
        await _execute_proposal_payload(db, proposal, user_id)

    return proposal


async def _execute_proposal_payload(db: AsyncSession, proposal: ResearchProposal, user_id: int):
    """根据提案类型执行对应的操作。"""
    payload = proposal.payload_json or {}
    ptype = proposal.proposal_type
    topic_id = proposal.topic_id
    logger.info("执行提案 payload proposal_id=%s type=%s", proposal.id, ptype)

    try:
        if ptype == "new_source":
            source = ResearchSource(
                topic_id=topic_id,
                user_id=user_id,
                title=str(payload.get("title", "")),
                url=str(payload.get("url", "")),
                source_type=str(payload.get("source_type", "web")),
                publisher=str(payload.get("publisher", "")),
                trust_level=str(payload.get("trust_level", "unverified")),
                status="active",
            )
            db.add(source)

        elif ptype == "new_entity":
            entity = await create_entity(db, topic_id, payload, user_id)
            if entity:
                logger.info("new_entity 提案创建实体 proposal_id=%s entity_id=%s", proposal.id, entity.id)

        elif ptype == "new_relation":
            relation = await create_relation(db, topic_id, payload, user_id)
            if relation:
                logger.info("new_relation 提案创建关系 proposal_id=%s relation_id=%s", proposal.id, relation.id)

        elif ptype == "new_claim":
            claim_text = str(payload.get("claim_text", "")).strip()
            if not claim_text:
                logger.warning("跳过空事实提案 proposal_id=%s", proposal.id)
                return
            confidence = _clamp_confidence(payload.get("confidence"))
            evidence_ids = _payload_int_list(payload, "evidence_ids")
            entity_ids = _payload_int_list(payload, "entity_ids")
            for entity_name in _coerce_str_list(payload.get("entity_names")):
                entity = await get_or_create_entity(db, topic_id, entity_name, user_id)
                if entity and entity.id not in entity_ids:
                    entity_ids.append(entity.id)
            valid_evidence = await _valid_supporting_evidence(db, topic_id, evidence_ids, user_id)
            logger.info(
                "new_claim 提案评估: claim=%r evidence_ids=%s valid_count=%d confidence=%d",
                claim_text[:80], evidence_ids, len(valid_evidence), confidence,
            )
            auto_adopt_reason = await _safe_new_claim_proposal_reason(
                db,
                topic_id,
                payload,
                user_id,
                claim_text,
                confidence,
                valid_evidence,
            )
            auto_adopt = auto_adopt_reason == "auto_adopted"
            claim = ResearchClaim(
                topic_id=topic_id,
                user_id=user_id,
                claim_text=claim_text,
                status="supported" if auto_adopt else "pending",
                confidence=confidence,
                claim_type=str(payload.get("claim_type", "")),
                adopted=auto_adopt,
                reasoning=payload.get("reasoning"),
            )
            db.add(claim)
            await db.flush()
            for evidence in valid_evidence:
                db.add(ResearchRelation(
                    topic_id=topic_id,
                    user_id=user_id,
                    from_type="evidence",
                    from_id=evidence.id,
                    to_type="claim",
                    to_id=claim.id,
                    relation_type="supports",
                ))
            linked_entity_ids = await link_claim_entities(db, claim.id, entity_ids, topic_id, user_id)
            logger.info(
                "new_claim 提案创建事实 proposal_id=%s claim_id=%s auto_adopt=%s reason=%s entity_count=%s",
                proposal.id,
                claim.id,
                auto_adopt,
                auto_adopt_reason,
                len(linked_entity_ids),
            )

        elif ptype == "mark_outdated":
            claim_id = payload.get("claim_id")
            if claim_id:
                claim = await db.get(ResearchClaim, int(claim_id))
                if claim and claim.user_id == user_id:
                    claim.status = "stale"

        elif ptype == "resolve_conflict":
            relation_id = payload.get("relation_id")
            accepted_claim_id = payload.get("accepted_claim_id")
            rejected_claim_id = payload.get("rejected_claim_id")
            if relation_id and accepted_claim_id and rejected_claim_id:
                rel = await db.get(ResearchRelation, int(relation_id))
                if rel and rel.user_id == user_id:
                    await _apply_conflict_resolution(
                        db,
                        rel,
                        int(accepted_claim_id),
                        int(rejected_claim_id),
                        user_id,
                    )
            elif relation_id:
                resolution = payload.get("resolution", "reject")
                rel = await db.get(ResearchRelation, int(relation_id))
                if rel and rel.user_id == user_id:
                    rel.metadata_json = {**(rel.metadata_json or {}), "resolution": resolution, "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}

        elif ptype == "update_summary":
            summary = payload.get("summary")
            if summary:
                topic = await db.get(ResearchTopic, topic_id)
                if topic and topic.user_id == user_id:
                    topic.summary = str(summary)

        await db.commit()
        logger.info("提案 payload 执行完成 proposal_id=%s type=%s", proposal.id, ptype)
    except Exception as e:
        logger.error("执行提案 payload 失败 proposal_id=%s: %s", proposal.id, e)
