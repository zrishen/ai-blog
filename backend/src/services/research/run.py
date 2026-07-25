"""研究运行（ResearchRun）编排：阶段化 Agent 执行 + 进度/日志记录 + 幂等创建。

_run_agent_stage 驱动单阶段 ReAct Agent；create_research_run 幂等建 run 并后台异步执行。
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from langgraph.prebuilt import create_react_agent
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    ResearchClaim,
    ResearchEvidence,
    ResearchRelation,
    ResearchRun,
    ResearchSource,
    ResearchTopic,
)
from src.tools.blog import current_user_id_cv

from .common import (
    DEFAULT_RUN_PROGRESS,
    RESEARCH_RUN_PROMPT,
    _count,
    _get_owned_topic,
    _truncate_detail,
)

logger = logging.getLogger(__name__)

_STAGE_LOG_MAX = 50

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
    from src.services.chat.llm_factory import _chat_model_kwargs, _create_llm
    from src.services.llm.llm_settings_service import get_user_llm_settings, has_usable_api_key
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
