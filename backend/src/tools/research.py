"""Research Graph 内部工具 — 供 ReAct Agent 在可信写作模式下使用。

规则（硬边界）：
- 搜索摘要只能作为线索（source_type=search_summary），不能保存为最终 Evidence。
- AI 自己总结的内容（kind=ai_generated_note）不能支撑 supported Claim。
- 没有有效 Evidence（kind=web|knowledge_base|mcp_tool|manual 且有 quote）的 Claim 不能进入 supported。
- Agent 写入的 Claim 满足自动采用条件时（有有效证据、无冲突、置信度≥85、无重复已采用声明）可自动进入 supported/adopted，否则为 pending 需用户审核。
- 低可信来源（trust_level=low）不能自动 adopted。
- 冲突 Claim 不能写成确定事实。
"""

import json
import logging
from datetime import datetime, timezone

from langchain_core.tools import tool
from sqlalchemy import select

from src.database.models import (
    ResearchClaim,
    ResearchClaimEntityLink,
    ResearchEntity,
    ResearchEvidence,
    ResearchProposal,
    ResearchRelation,
    ResearchSource,
    ResearchTopic,
)
from src.database.session import async_session
from src.tools.blog import current_user_id_cv
from src.services.research_service import (
    ENTITY_TYPES,
    SUPPORTED_EVIDENCE_KINDS,
    VALID_RELATION_NODE_TYPES,
    VALID_RELATION_TYPES,
    _get_owned_topic,
    _safe_new_claim_proposal_reason,
    _topic_summary,
    create_claim,
    create_entity,
    create_relation,
)

logger = logging.getLogger(__name__)

# Evidence kind 说明（供 Agent 参考）
EVIDENCE_KIND_HELP = {
    "web": "从网页正文中摘录的原文片段（最常用的证据类型）",
    "knowledge_base": "从用户知识库文档中摘录的原文片段",
    "mcp_tool": "MCP 工具返回的可追溯原文片段（必须有来源 URL 或标题）",
    "manual": "用户手动提供的资料原文",
    "ai_generated_note": "AI 自己的总结或推理 — 不能用于支撑 supported Claim，只能作为备注",
}

# Source type 说明
SOURCE_TYPE_HELP = {
    "official": "官方文档、官方公告、标准组织、法规、论文原文",
    "media": "权威媒体、专业数据库、主流技术媒体",
    "paper": "学术论文",
    "blog": "公司博客、开发者文档、行业报告",
    "forum": "普通博客、论坛、社交媒体",
    "social": "社交媒体帖子",
    "knowledge_base": "用户知识库中的文档",
    "mcp_result": "MCP 工具返回的结果",
    "manual": "用户手动添加的来源",
    "search_summary": "搜索引擎摘要 — 只能作为线索，不能作为最终 Evidence",
}

# 可信等级
TRUST_LEVELS = ["high", "medium", "low", "unverified"]


# ═══════════════════════════════════════════════════
# 研究主题工具
# ═══════════════════════════════════════════════════

@tool
async def research_create_topic(title: str, description: str = "") -> str:
    """创建或复用研究主题。在可信写作模式下，写文章前应先创建研究主题来收集来源和证据。
    如果已存在同名主题，会返回已有主题 ID 供复用。
    参数 title: 研究主题标题（必填），例如 "AI 模型发展 2025"。
    参数 description: 主题描述（可选），说明研究范围和目标。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法创建研究主题。"

    async with async_session() as db:
        existing = await db.execute(
            select(ResearchTopic).where(
                ResearchTopic.user_id == user_id,
                ResearchTopic.title == title.strip(),
            )
        )
        topic = existing.scalar_one_or_none()
        if topic:
            summary = await _topic_summary(db, topic)
            return (
                f"已存在同名研究主题（ID={topic.id}），无需重复创建。\n"
                f"当前状态: {topic.status}，来源 {summary['source_count']} 个，"
                f"事实 {summary['claim_count']} 条，冲突 {summary['conflict_count']} 条。"
            )

        topic = ResearchTopic(
            user_id=user_id,
            title=title.strip(),
            description=description.strip() or None,
            status="draft",
        )
        db.add(topic)
        await db.commit()
        await db.refresh(topic)
        return (
            f"研究主题已创建: ID={topic.id}, title={topic.title}, status={topic.status}。\n"
            "下一步请使用 research_add_source 添加信息来源，"
            "然后使用 research_add_evidence 记录原文证据片段，"
            "最后使用 research_add_claim 抽取事实声明。"
        )


@tool
async def research_get_topic(topic_id: int = 0) -> str:
    """读取研究主题的当前上下文，包括已收集的来源、证据、事实、实体和冲突关系。
    在可信写作模式下，写文章前应先用此工具了解当前主题已有哪些已确认事实。
    参数 topic_id: 研究主题 ID（必填）。如果传入 0 或不传，会列出当前用户所有主题。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法读取研究主题。"

    async with async_session() as db:
        if topic_id <= 0:
            result = await db.execute(
                select(ResearchTopic).where(ResearchTopic.user_id == user_id).order_by(ResearchTopic.updated_at.desc())
            )
            topics = result.scalars().all()
            if not topics:
                return "当前没有研究主题。请使用 research_create_topic 创建第一个主题。"
            lines = ["研究主题列表:"]
            for t in topics:
                summary = await _topic_summary(db, t)
                lines.append(
                    f"  [{t.id}] {t.title} | 状态:{t.status} | "
                    f"来源:{summary['source_count']} 事实:{summary['claim_count']} 实体:{summary['entity_count']} 冲突:{summary['conflict_count']}"
                )
            return "\n".join(lines)

        topic = await _get_owned_topic(db, topic_id, user_id)
        if not topic:
            return f"研究主题不存在: ID={topic_id}"

        summary = await _topic_summary(db, topic)

        # 已确认的事实
        claims_result = await db.execute(
            select(ResearchClaim).where(
                ResearchClaim.topic_id == topic_id,
                ResearchClaim.user_id == user_id,
            ).order_by(ResearchClaim.status, ResearchClaim.confidence.desc())
        )
        claims = claims_result.scalars().all()

        # 来源
        sources_result = await db.execute(
            select(ResearchSource).where(
                ResearchSource.topic_id == topic_id,
                ResearchSource.user_id == user_id,
            )
        )
        sources = sources_result.scalars().all()

        # 实体
        entities_result = await db.execute(
            select(ResearchEntity)
            .where(
                ResearchEntity.topic_id == topic_id,
                ResearchEntity.user_id == user_id,
            )
            .order_by(ResearchEntity.confidence.desc(), ResearchEntity.name)
        )
        entities = entities_result.scalars().all()
        entities_by_id = {entity.id: entity for entity in entities}

        links_result = await db.execute(
            select(ResearchClaimEntityLink).where(
                ResearchClaimEntityLink.topic_id == topic_id,
                ResearchClaimEntityLink.user_id == user_id,
            )
        )
        claim_entity_links = links_result.scalars().all()
        entity_names_by_claim: dict[int, list[str]] = {}
        for link in claim_entity_links:
            entity = entities_by_id.get(link.entity_id)
            if entity:
                entity_names_by_claim.setdefault(link.claim_id, []).append(entity.name)

        lines = [
            f"研究主题: {topic.title} (ID={topic.id})",
            f"状态: {topic.status}",
            f"描述: {topic.description or '无'}",
            f"摘要: {topic.summary or '无'}",
            f"来源 {summary['source_count']} 个，事实 {summary['claim_count']} 条，实体 {summary['entity_count']} 个，冲突 {summary['conflict_count']} 个",
            "",
        ]

        if sources:
            lines.append("--- 来源 ---")
            for s in sources:
                lines.append(
                    f"  [{s.id}] {s.title} | 类型:{s.source_type} | "
                    f"可信:{s.trust_level} | 状态:{s.status}"
                )
                if s.url:
                    lines.append(f"       URL: {s.url}")
            lines.append("")

        if entities:
            lines.append("--- 关键实体 ---")
            for e in entities:
                aliases = json.loads(e.aliases_json) if isinstance(e.aliases_json, str) else (e.aliases_json or [])
                alias_str = f" | 别名:{', '.join(aliases)}" if aliases else ""
                description = f" | 描述:{e.description[:80]}" if e.description else ""
                lines.append(
                    f"  [{e.id}] {e.name} | 类型:{e.entity_type or '-'} | "
                    f"置信度:{e.confidence} | 状态:{e.status}{alias_str}{description}"
                )
            lines.append("")

        if claims:
            lines.append("--- 事实声明 ---")
            for c in claims:
                adopted_mark = " [已采用]" if c.adopted else ""
                linked_entities = entity_names_by_claim.get(c.id, [])
                entity_note = f" | 关联实体:{', '.join(linked_entities)}" if linked_entities else ""
                lines.append(
                    f"  [{c.id}] {c.claim_text[:120]} | 状态:{c.status} | "
                    f"置信度:{c.confidence}{adopted_mark}{entity_note}"
                )
            lines.append("")

        entity_relations_result = await db.execute(
            select(ResearchRelation).where(
                ResearchRelation.topic_id == topic_id,
                ResearchRelation.user_id == user_id,
                (ResearchRelation.from_type == "entity") | (ResearchRelation.to_type == "entity"),
            )
        )
        entity_relations = entity_relations_result.scalars().all()
        if entity_relations:
            lines.append("--- 实体关系 ---")
            for rel in entity_relations:
                from_label = entities_by_id[rel.from_id].name if rel.from_type == "entity" and rel.from_id in entities_by_id else f"{rel.from_type}#{rel.from_id}"
                to_label = entities_by_id[rel.to_id].name if rel.to_type == "entity" and rel.to_id in entities_by_id else f"{rel.to_type}#{rel.to_id}"
                lines.append(f"  {from_label} --{rel.relation_type}--> {to_label}")
            lines.append("")

        # 冲突关系
        conflicts_result = await db.execute(
            select(ResearchRelation).where(
                ResearchRelation.topic_id == topic_id,
                ResearchRelation.user_id == user_id,
                ResearchRelation.relation_type == "conflicts_with",
            )
        )
        conflicts = conflicts_result.scalars().all()
        if conflicts:
            lines.append("--- 冲突 ---")
            for rel in conflicts:
                lines.append(f"  {rel.from_type}#{rel.from_id} ←→ {rel.to_type}#{rel.to_id}")

        return "\n".join(lines)


# ═══════════════════════════════════════════════════
# 来源工具
# ═══════════════════════════════════════════════════

@tool
async def research_add_source(
    topic_id: int,
    title: str,
    url: str = "",
    source_type: str = "web",
    publisher: str = "",
    published_at: str = "",
    trust_level: str = "unverified",
    summary: str = "",
) -> str:
    """向研究主题添加信息来源。搜索摘要只能作为线索（source_type=search_summary），不能作为最终证据来源。
    参数 topic_id: 研究主题 ID（必填）。
    参数 title: 来源标题（必填），如文章标题、文档名称。
    参数 url: 来源 URL（可选）。
    参数 source_type: 来源类型，可选 official/media/paper/blog/forum/social/knowledge_base/mcp_result/manual/search_summary。
    参数 publisher: 发布者名称（可选）。
    参数 published_at: 发布时间，ISO 格式字符串（可选）。
    参数 trust_level: 可信等级 high/medium/low/unverified，默认 unverified。
    参数 summary: 来源内容摘要（可选），搜索摘要类型时必须填写。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法添加来源。"

    if source_type not in SOURCE_TYPE_HELP:
        return f"错误: 无效的来源类型 '{source_type}'。可选: {', '.join(SOURCE_TYPE_HELP.keys())}"

    if trust_level not in TRUST_LEVELS:
        return f"错误: 无效的可信等级 '{trust_level}'。可选: {', '.join(TRUST_LEVELS)}"

    if source_type == "search_summary":
        return (
            "警告: search_summary 只能作为线索，不能作为最终 Evidence 来源。\n"
            "如果要添加搜索摘要作为线索，请确保后续通过 research_add_evidence 从原始网页中提取原文证据。\n"
            "请将 source_type 改为 web/blog/official 等实际来源类型，或明确标注为线索。"
        )

    async with async_session() as db:
        topic = await _get_owned_topic(db, topic_id, user_id)
        if not topic:
            return f"研究主题不存在: ID={topic_id}"

        # URL 去重（同一主题下）
        if url.strip():
            existing = await db.execute(
                select(ResearchSource).where(
                    ResearchSource.topic_id == topic_id,
                    ResearchSource.user_id == user_id,
                    ResearchSource.url == url.strip(),
                )
            )
            dup = existing.scalar_one_or_none()
            if dup:
                return f"此 URL 已存在于当前主题的来源 [{dup.id}] {dup.title}，跳过重复添加。"

        source = ResearchSource(
            topic_id=topic_id,
            user_id=user_id,
            title=title.strip(),
            url=url.strip() or None,
            source_type=source_type,
            publisher=publisher.strip() or None,
            trust_level=trust_level,
            status="active",
            raw_excerpt=summary.strip() or None,
        )
        if published_at.strip():
            try:
                from datetime import datetime as dt
                source.published_at = dt.fromisoformat(published_at.strip())
            except (ValueError, TypeError):
                pass

        source.fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(source)
        await db.commit()
        await db.refresh(source)
        return f"来源已添加: [{source.id}] {source.title} (类型:{source.source_type}, 可信:{source.trust_level})"


# ═══════════════════════════════════════════════════
# 证据工具
# ═══════════════════════════════════════════════════

@tool
async def research_add_evidence(
    topic_id: int,
    source_id: int,
    quote: str,
    kind: str = "web",
    location: str = "",
) -> str:
    """向研究主题添加原文证据片段。这是 Claim 的依据，必须来自可追溯的原文。
    参数 topic_id: 研究主题 ID（必填）。
    参数 source_id: 所属来源 ID（必填），需先通过 research_add_source 创建来源。
    参数 quote: 原文摘录（必填），必须是来源中的原文，不能是 AI 总结或改写。
    参数 kind: 证据类型 web/knowledge_base/mcp_tool/manual/ai_generated_note。
              ai_generated_note 不能用于支撑 supported Claim。
    参数 location: 原文位置说明（可选），如段落号、章节名。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法添加证据。"

    if not quote.strip():
        return "错误: quote 不能为空。证据必须包含原文摘录。"

    if kind not in EVIDENCE_KIND_HELP:
        return f"错误: 无效的证据类型 '{kind}'。可选: {', '.join(EVIDENCE_KIND_HELP.keys())}"

    async with async_session() as db:
        topic = await _get_owned_topic(db, topic_id, user_id)
        if not topic:
            return f"研究主题不存在: ID={topic_id}"

        source = await db.get(ResearchSource, source_id)
        if not source or source.topic_id != topic_id or source.user_id != user_id:
            return f"来源不存在或不属于当前主题: ID={source_id}"

        evidence = ResearchEvidence(
            topic_id=topic_id,
            source_id=source_id,
            user_id=user_id,
            quote=quote.strip(),
            kind=kind,
            location=location.strip() or None,
        )
        db.add(evidence)
        await db.commit()
        await db.refresh(evidence)

        note = ""
        if kind == "ai_generated_note":
            note = (
                "\n⚠️ 注意: ai_generated_note 类型的证据不能用于支撑 supported Claim。"
                "如需支撑事实，请使用 web/knowledge_base/mcp_tool/manual 类型的证据。"
            )
        return f"证据已添加: [{evidence.id}] kind={kind}{note}"


# ═══════════════════════════════════════════════════
# 实体工具
# ═══════════════════════════════════════════════════

@tool
async def research_add_entity(
    topic_id: int,
    name: str,
    entity_type: str = "other",
    description: str = "",
    confidence: int = 0,
    aliases: str = "",
) -> str:
    """向研究主题添加或复用关键实体。研究 Claim 中出现关键概念、技术、组织、产品、方法时应先创建或复用实体。
    参数 topic_id: 研究主题 ID（必填）。
    参数 name: 实体名称（必填），如 RAG、AI 幻觉、Anthropic。
    参数 entity_type: 实体类型，可选 concept/technology/person/organization/product/method/claim_subject/other。
    参数 description: 实体说明（可选）。
    参数 confidence: 置信度 0-100。
    参数 aliases: 别名，逗号分隔（可选），如 "Retrieval-Augmented Generation,检索增强生成"。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法添加实体。"

    if not name.strip():
        return "错误: name 不能为空。"

    if entity_type not in ENTITY_TYPES:
        return f"错误: entity_type '{entity_type}' 无效。可选: {', '.join(sorted(ENTITY_TYPES))}"

    alias_list = [item.strip() for item in aliases.split(",") if item.strip()]
    async with async_session() as db:
        try:
            entity = await create_entity(
                db,
                topic_id,
                {
                    "name": name.strip(),
                    "entity_type": entity_type,
                    "description": description.strip() or None,
                    "confidence": confidence,
                    "aliases": alias_list,
                },
                user_id,
            )
        except ValueError as exc:
            return f"错误: {exc}"
        if not entity:
            return f"研究主题不存在: ID={topic_id}"

        aliases_note = ""
        aliases_json = json.loads(entity.aliases_json) if isinstance(entity.aliases_json, str) else (entity.aliases_json or [])
        if aliases_json:
            aliases_note = f" | 别名:{', '.join(aliases_json)}"
        return (
            f"实体已添加或复用: [{entity.id}] {entity.name} | 类型:{entity.entity_type or '-'} | "
            f"置信度:{entity.confidence} | 状态:{entity.status}{aliases_note}"
        )


# ═══════════════════════════════════════════════════
# 事实声明工具
# ═══════════════════════════════════════════════════

@tool
async def research_add_claim(
    topic_id: int,
    claim_text: str,
    claim_type: str = "",
    evidence_ids: str = "",
    confidence: int = 0,
    reasoning: str = "",
    entity_names: str = "",
) -> str:
    """向研究主题添加事实声明（Claim）。满足自动采用条件时（有有效证据、无冲突、置信度≥85、无重复已采用声明）将自动设为 supported/adopted，否则为 pending 需用户审核。
    参数 topic_id: 研究主题 ID（必填）。
    参数 claim_text: 事实声明文本（必填），必须是可验证的具体陈述。
    参数 claim_type: 声明类型（可选），如 fact/opinion/statistic/date/definition。
    参数 evidence_ids: 支持此声明的证据 ID，逗号分隔（可选），如 "1,2,3"。
    参数 confidence: 置信度 0-100（默认 0），基于来源可信度和多源一致性。
    参数 reasoning: 置信度判断依据（可选）。
    参数 entity_names: Claim 涉及的实体名称，逗号分隔（可选），如 "RAG,AI 幻觉"。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法添加事实声明。"

    if not claim_text.strip():
        return "错误: claim_text 不能为空。"

    parsed_ids: list[int] = []
    if evidence_ids.strip():
        try:
            parsed_ids = [int(x.strip()) for x in evidence_ids.split(",") if x.strip()]
        except ValueError:
            return "错误: evidence_ids 格式不正确，请使用逗号分隔的数字，如 '1,2,3'。"

    parsed_entity_names = [item.strip() for item in entity_names.split(",") if item.strip()]

    async with async_session() as db:
        topic = await _get_owned_topic(db, topic_id, user_id)
        if not topic:
            return f"研究主题不存在: ID={topic_id}"

        valid_evidence: list[ResearchEvidence] = []
        if parsed_ids:
            evidence_result = await db.execute(
                select(ResearchEvidence).where(
                    ResearchEvidence.id.in_(parsed_ids),
                    ResearchEvidence.topic_id == topic_id,
                    ResearchEvidence.user_id == user_id,
                    ResearchEvidence.quote != "",
                    ResearchEvidence.kind.in_(SUPPORTED_EVIDENCE_KINDS),
                )
            )
            valid_evidence = list(evidence_result.scalars().all())

        clamped_confidence = min(max(confidence, 0), 100)
        payload = {
            "claim_text": claim_text.strip(),
            "claim_type": claim_type.strip() or None,
            "confidence": clamped_confidence,
            "evidence_ids": parsed_ids,
            "entity_names": parsed_entity_names,
            "reasoning": reasoning.strip() or None,
        }
        auto_adopt_reason = await _safe_new_claim_proposal_reason(
            db,
            topic_id,
            payload,
            user_id,
            claim_text.strip(),
            clamped_confidence,
            valid_evidence,
        )
        auto_adopt = auto_adopt_reason == "auto_adopted"
        payload["status"] = "supported" if auto_adopt else "pending"
        payload["adopted"] = auto_adopt

        try:
            claim = await create_claim(db, topic_id, payload, user_id)
        except ValueError as exc:
            return f"错误: {exc}"
        if not claim:
            return f"研究主题不存在: ID={topic_id}"

        linked_entity_names: list[str] = []
        linked_entity_ids = getattr(claim, "entity_ids", [])
        if linked_entity_ids:
            entities_result = await db.execute(
                select(ResearchEntity).where(
                    ResearchEntity.id.in_(linked_entity_ids),
                    ResearchEntity.topic_id == topic_id,
                    ResearchEntity.user_id == user_id,
                )
            )
            linked_entity_names = [entity.name for entity in entities_result.scalars().all()]

        if auto_adopt:
            status_note = "supported（已自动采用）"
        else:
            status_note = f"pending（需用户审核，原因:{auto_adopt_reason}）"
        ev_note = ""
        if parsed_ids and not valid_evidence:
            ev_note = (
                "\n⚠️ 提供的 evidence 无效或类型不允许支撑事实（ai_generated_note/search_summary 不能作为有效证据）。"
                "请先使用 research_add_evidence 从可追溯原文中添加有效证据（kind=web/knowledge_base/mcp_tool/manual）。"
            )
        elif not parsed_ids:
            ev_note = "\n提示: 未提供证据。没有有效证据的 Claim 无法进入 supported 状态。"
        entity_note = f" | 关联实体:{', '.join(linked_entity_names)}" if linked_entity_names else ""

        return (
            f"事实声明已添加: [{claim.id}] {claim.claim_text[:120]} | 状态:{status_note} | "
            f"置信度:{claim.confidence}{entity_note}{ev_note}"
        )


# ═══════════════════════════════════════════════════
# 关系工具
# ═══════════════════════════════════════════════════

@tool
async def research_add_relation(
    topic_id: int,
    from_type: str,
    from_id: int,
    to_type: str,
    to_id: int,
    relation_type: str,
    note: str = "",
) -> str:
    """在研究主题中建立两个对象之间的关系。
    参数 topic_id: 研究主题 ID（必填）。
    参数 from_type: 来源对象类型 source/evidence/claim/entity（必填）。
    参数 from_id: 来源对象 ID（必填）。
    参数 to_type: 目标对象类型 source/evidence/claim/entity（必填）。
    参数 to_id: 目标对象 ID（必填）。
    参数 relation_type: 关系类型 supports/conflicts_with/updates/outdated_by/mentions/derived_from/related_to/uses/improves/reduces/depends_on/part_of/is_a（必填）。
    参数 note: 关系说明（可选），如冲突的具体原因。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法添加关系。"

    if from_type not in VALID_RELATION_NODE_TYPES:
        return f"错误: from_type '{from_type}' 无效。可选: {', '.join(sorted(VALID_RELATION_NODE_TYPES))}"
    if to_type not in VALID_RELATION_NODE_TYPES:
        return f"错误: to_type '{to_type}' 无效。可选: {', '.join(sorted(VALID_RELATION_NODE_TYPES))}"
    if relation_type not in VALID_RELATION_TYPES:
        return f"错误: relation_type '{relation_type}' 无效。可选: {', '.join(sorted(VALID_RELATION_TYPES))}"

    async with async_session() as db:
        try:
            rel = await create_relation(
                db,
                topic_id,
                {
                    "from_type": from_type,
                    "from_id": from_id,
                    "to_type": to_type,
                    "to_id": to_id,
                    "relation_type": relation_type,
                    "metadata": {"note": note.strip()} if note.strip() else None,
                },
                user_id,
            )
        except ValueError as exc:
            return f"错误: {exc}"
        if not rel:
            return f"研究主题不存在: ID={topic_id}"

        return f"关系已添加或复用: [{rel.id}] {from_type}#{from_id} --{relation_type}--> {to_type}#{to_id}"


# ═══════════════════════════════════════════════════
# 提案工具
# ═══════════════════════════════════════════════════

@tool
async def research_add_proposal(
    topic_id: int,
    proposal_type: str,
    title: str,
    description: str = "",
    payload: str = "",
) -> str:
    """生成研究主题的更新提案，供用户审核。用于新增来源、新增事实、新增实体、新增关系、标记过时、处理冲突等场景。
    参数 topic_id: 研究主题 ID（必填）。
    参数 proposal_type: 提案类型 new_source/new_claim/new_entity/new_relation/mark_outdated/resolve_conflict/update_summary（必填）。
    参数 title: 提案标题（必填）。
    参数 description: 提案描述（可选），说明变更原因和影响。
    参数 payload: JSON 格式的提案数据（按 proposal_type 要求填写必填字段）：
      - new_source: {"url", "title", "source_type"(web/manual), "publisher", "trust_level"}
      - new_claim: {"claim_text"(必填), "confidence"(0-100), "evidence_ids"(证据ID数组或逗号分隔), "entity_names"(实体名数组或逗号分隔), "claim_type"}
      - new_entity: {"name"(必填), "entity_type", "description", "confidence", "aliases"}
      - new_relation: {"from_type", "from_id", "to_type", "to_id", "relation_type", "metadata"}
      - mark_outdated: {"claim_id"}
      - resolve_conflict: {"relation_id", "resolution"(reject/accept)}
      - update_summary: {"summary"}
    注意：new_claim 类型必须带 evidence_ids 且引用的证据 kind 必须为 web/knowledge_base/mcp_tool/manual（不能是 search_summary），否则事实将无法自动采用。"""
    user_id = current_user_id_cv.get()
    if user_id is None:
        return "错误: 未认证用户无法创建提案。"

    valid_proposal_types = {"new_source", "new_claim", "new_entity", "new_relation", "mark_outdated", "resolve_conflict", "update_summary"}
    if proposal_type not in valid_proposal_types:
        return f"错误: proposal_type '{proposal_type}' 无效。可选: {', '.join(sorted(valid_proposal_types))}"

    payload_json = None
    if payload.strip():
        try:
            payload_json = json.loads(payload)
        except json.JSONDecodeError:
            return "错误: payload 不是有效的 JSON 格式。"

    async with async_session() as db:
        topic = await _get_owned_topic(db, topic_id, user_id)
        if not topic:
            return f"研究主题不存在: ID={topic_id}"

        proposal = ResearchProposal(
            topic_id=topic_id,
            user_id=user_id,
            proposal_type=proposal_type,
            title=title.strip(),
            description=description.strip() or None,
            payload_json=payload_json,
            status="pending",
        )
        db.add(proposal)
        await db.commit()
        await db.refresh(proposal)

        return (
            f"提案已生成: [{proposal.id}] {proposal.title} | 类型:{proposal.proposal_type} | 状态:pending（待审核）\n"
            "请在研究图谱页的「提案」tab 中审核此提案。"
        )


# ═══════════════════════════════════════════════════
# 工具列表
# ═══════════════════════════════════════════════════

RESEARCH_TOOLS = [
    research_create_topic,
    research_get_topic,
    research_add_source,
    research_add_evidence,
    research_add_entity,
    research_add_claim,
    research_add_relation,
    research_add_proposal,
]
