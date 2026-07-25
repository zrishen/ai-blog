"""研究图谱路由。"""

import logging
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.schemas.research import (
    BlogPostClaimAttach,
    BlogPostClaimLinkRead,
    BlogPostResearchAttach,
    BlogPostResearchLinkRead,
    BlogResearchSummary,
    ResearchClaimCreate,
    ResearchClaimRead,
    ResearchClaimUpdate,
    ResearchConflictResolve,
    ResearchDraftPreview,
    ResearchEntityCreate,
    ResearchEntityRead,
    ResearchEntityUpdate,
    ResearchProposalRead,
    ResearchProposalUpdate,
    ResearchRelationRead,
    ResearchRunRead,
    ResearchTopicCreate,
    ResearchTopicDetail,
    ResearchTopicRead,
    ResearchTopicUpdate,
)
from src.services import research as research_service
from src.utils.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/research/topics", response_model=list[ResearchTopicRead])
async def list_research_topics(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await research_service.list_topics(db, user.id)


@router.post("/research/topics", response_model=ResearchTopicRead, status_code=201)
async def create_research_topic(
    data: ResearchTopicCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    logger.info("API 创建研究主题 user=%s title=%s", user.id, data.title)
    return await research_service.create_topic(db, data.model_dump(), user.id)


@router.get("/research/topics/{topic_id}", response_model=ResearchTopicDetail)
async def get_research_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    topic = await research_service.get_topic_detail(db, topic_id, user.id)
    if not topic:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return topic


@router.post("/research/topics/{topic_id}/entities", response_model=ResearchEntityRead, status_code=201)
async def create_research_entity(
    topic_id: int,
    data: ResearchEntityCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        entity = await research_service.create_entity(db, topic_id, data.model_dump(), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not entity:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return entity


@router.get("/research/topics/{topic_id}/entities", response_model=list[ResearchEntityRead])
async def list_research_entities(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entities = await research_service.list_entities(db, topic_id, user.id)
    if entities is None:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return entities


@router.get("/research/entities/{entity_id}", response_model=ResearchEntityRead)
async def get_research_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entity = await research_service.get_entity_detail(db, entity_id, user.id)
    if not entity:
        raise HTTPException(status_code=404, detail="Research entity not found")
    return entity


@router.patch("/research/entities/{entity_id}", response_model=ResearchEntityRead)
async def update_research_entity(
    entity_id: int,
    data: ResearchEntityUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        entity = await research_service.update_entity(db, entity_id, data.model_dump(exclude_unset=True), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not entity:
        raise HTTPException(status_code=404, detail="Research entity not found")
    return entity


@router.delete("/research/entities/{entity_id}", status_code=204)
async def delete_research_entity(
    entity_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    deleted = await research_service.delete_entity(db, entity_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Research entity not found")


@router.patch("/research/topics/{topic_id}", response_model=ResearchTopicRead)
async def update_research_topic(
    topic_id: int,
    data: ResearchTopicUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    topic = await research_service.update_topic(db, topic_id, data.model_dump(exclude_unset=True), user.id)
    if not topic:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return topic


@router.post("/research/topics/{topic_id}/archive")
async def archive_research_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    logger.info("API 归档研究主题 topic_id=%s user=%s", topic_id, user.id)
    archived = await research_service.archive_topic(db, topic_id, user.id)
    if not archived:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return {"status": "ok"}


@router.delete("/research/topics/{topic_id}", status_code=204)
async def delete_research_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    logger.info("API 物理删除研究主题 topic_id=%s user=%s", topic_id, user.id)
    deleted = await research_service.delete_topic(db, topic_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Research topic not found")


@router.post("/research/topics/{topic_id}/run", response_model=ResearchRunRead, status_code=202)
async def run_research_topic(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    logger.info("API 启动研究运行 topic_id=%s user=%s idempotency_key=%s", topic_id, user.id, idempotency_key)
    run = await research_service.create_research_run(db, topic_id, user.id, idempotency_key)
    if not run:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return research_service.run_response(run)


@router.get("/research/topics/{topic_id}/runs", response_model=list[ResearchRunRead])
async def list_research_runs(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    runs = await research_service.list_research_runs(db, topic_id, user.id)
    if runs is None:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return runs


@router.post("/research/topics/{topic_id}/draft-preview", response_model=ResearchDraftPreview)
async def generate_research_draft_preview(
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = await research_service.generate_draft_preview(db, topic_id, user.id)
    if not draft:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return draft


@router.post("/research/topics/{topic_id}/claims", response_model=ResearchClaimRead, status_code=201)
async def create_research_claim(
    topic_id: int,
    data: ResearchClaimCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        claim = await research_service.create_claim(db, topic_id, data.model_dump(), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not claim:
        raise HTTPException(status_code=404, detail="Research topic not found")
    return claim


@router.patch("/research/claims/{claim_id}", response_model=ResearchClaimRead)
async def update_research_claim(
    claim_id: int,
    data: ResearchClaimUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        claim = await research_service.update_claim(db, claim_id, data.model_dump(exclude_unset=True), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not claim:
        raise HTTPException(status_code=404, detail="Research claim not found")
    return claim


@router.post("/research/conflicts/{relation_id}/resolve", response_model=ResearchRelationRead)
async def resolve_research_conflict(
    relation_id: int,
    data: ResearchConflictResolve,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        relation = await research_service.resolve_conflict(db, relation_id, data.model_dump(), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not relation:
        raise HTTPException(status_code=404, detail="Research conflict not found")
    return relation


@router.patch("/research/proposals/{proposal_id}", response_model=ResearchProposalRead)
async def update_research_proposal(
    proposal_id: int,
    data: ResearchProposalUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    proposal = await research_service.update_proposal(db, proposal_id, data.model_dump(exclude_unset=True), user.id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Research proposal not found")
    return proposal


@router.post("/blog/posts/{post_id}/research-topics", response_model=BlogPostResearchLinkRead, status_code=201)
async def attach_research_topic_to_post(
    post_id: int,
    data: BlogPostResearchAttach,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    link = await research_service.attach_topic_to_post(db, post_id, data.topic_id, user.id)
    if not link:
        raise HTTPException(status_code=404, detail="Post or research topic not found")
    return link


@router.get("/blog/posts/{post_id}/research-summary", response_model=BlogResearchSummary)
async def get_blog_research_summary(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    summary = await research_service.get_blog_research_summary(db, post_id, user.id)
    if not summary:
        raise HTTPException(status_code=404, detail="Post not found")
    return summary


@router.delete("/blog/posts/{post_id}/research-topics/{topic_id}", status_code=204)
async def detach_research_topic_from_post(
    post_id: int,
    topic_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    deleted = await research_service.detach_topic_from_post(db, post_id, topic_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Post or topic link not found")


@router.post("/blog/posts/{post_id}/claims", response_model=BlogPostClaimLinkRead, status_code=201)
async def adopt_claim_for_post(
    post_id: int,
    data: BlogPostClaimAttach,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    link = await research_service.attach_claim_to_post(db, post_id, data.claim_id, user.id, data.usage_note)
    if not link:
        raise HTTPException(status_code=404, detail="Post or claim not found")
    return link


@router.delete("/blog/posts/{post_id}/claims/{claim_id}", status_code=204)
async def remove_claim_from_post(
    post_id: int,
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    deleted = await research_service.detach_claim_from_post(db, post_id, claim_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Claim link not found")
