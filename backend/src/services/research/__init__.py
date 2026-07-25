"""research 域 service 包。

对外门面：聚合 topic / entity / claim / relation / proposal / run / post_link 各子模块的公共 API。
调用方可 `from src.services import research as research_service` 后用 research_service.xxx 访问，
或直接 `from src.services.research import create_topic` 等具名导入。

内部按聚合根拆分（common 为依赖根）：
common ← {topic, entity, relation, run, post_link}；common ← entity ← claim；{entity, relation, claim} ← proposal。
"""

# ruff: noqa: F401  # 门面 re-export，符号供外部按具名或 research_service.xxx 使用
from .claim import _apply_conflict_resolution, create_claim, resolve_conflict, update_claim
from .common import (
    AUTO_ADOPT_MIN_CONFIDENCE,
    DEFAULT_RUN_PROGRESS,
    ENTITY_STATUSES,
    ENTITY_TYPES,
    SUPPORTED_EVIDENCE_KINDS,
    VALID_RELATION_NODE_TYPES,
    VALID_RELATION_TYPES,
    _get_owned_post,
    _get_owned_topic,
    _safe_new_claim_proposal_reason,
    _topic_summary,
)
from .entity import (
    create_entity,
    delete_entity,
    get_entity_detail,
    get_or_create_entity,
    link_claim_entities,
    list_entities,
    update_entity,
)
from .post_link import (
    _build_post_snapshot,
    _link_response,
    attach_adopted_claims_for_topic_to_post,
    attach_claim_to_post,
    attach_topic_to_post,
    detach_claim_from_post,
    detach_topic_from_post,
    get_blog_research_summary,
)
from .proposal import update_proposal
from .relation import create_relation
from .run import (
    _build_research_prompt,
    _count_stage_output,
    _ensure_reviewable_claim_for_run,
    _run_agent_stage,
    create_research_run,
    generate_draft_preview,
    list_research_runs,
    run_response,
)
from .topic import (
    archive_topic,
    create_topic,
    delete_topic,
    get_topic_detail,
    list_topics,
    update_topic,
)
