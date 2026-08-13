"""大脑只读 API：知识图谱 / 实体 / 记忆 / 偏好 / 事实 / 统计。

memory_enabled=False 时返回空结构 + enabled=False（不 503，前端展示空态）。
"""

from fastapi import APIRouter, Depends, Query, Response, status

from src.schemas.brain import (
    BrainEntity,
    BrainEpisode,
    BrainFact,
    BrainFactCorrection,
    BrainGraph,
    BrainPreference,
    BrainPreferenceUpdate,
    BrainStats,
)
from src.services.memory.brain_service import (
    correct_fact,
    delete_memory,
    get_graph,
    get_stats,
    list_entities,
    list_episodes,
    list_facts,
    list_preferences,
    update_preference,
)
from src.utils.auth import get_current_user

router = APIRouter(tags=["brain"])


@router.get("/brain/stats", response_model=BrainStats)
async def brain_stats(user=Depends(get_current_user)):
    return await get_stats(user.id)


@router.get("/brain/graph", response_model=BrainGraph)
async def brain_graph(
    user=Depends(get_current_user),
    limit: int = Query(80, ge=1, le=300),
):
    return await get_graph(user.id, limit)


@router.get("/brain/entities", response_model=list[BrainEntity])
async def brain_entities(
    user=Depends(get_current_user),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return await list_entities(user.id, limit, offset)


@router.get("/brain/episodes", response_model=list[BrainEpisode])
async def brain_episodes(
    user=Depends(get_current_user),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return await list_episodes(user.id, limit, offset)


@router.get("/brain/preferences", response_model=list[BrainPreference])
async def brain_preferences(user=Depends(get_current_user)):
    return await list_preferences(user.id)


@router.get("/brain/facts", response_model=list[BrainFact])
async def brain_facts(
    user=Depends(get_current_user),
    entity_id: str | None = None,
    only_valid: bool = True,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return await list_facts(user.id, entity_id, only_valid, limit, offset)


@router.delete("/brain/memories/{memory_type}/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def brain_delete_memory(
    memory_type: str,
    memory_id: str,
    user=Depends(get_current_user),
) -> Response:
    await delete_memory(user.id, memory_type, memory_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/brain/facts/{fact_id}", response_model=BrainFact)
async def brain_correct_fact(
    fact_id: str,
    payload: BrainFactCorrection,
    user=Depends(get_current_user),
):
    return await correct_fact(user.id, fact_id, **payload.model_dump())


@router.put("/brain/preferences/{pref_id}", response_model=BrainPreference)
async def brain_update_preference(
    pref_id: str,
    payload: BrainPreferenceUpdate,
    user=Depends(get_current_user),
):
    return await update_preference(user.id, pref_id, **payload.model_dump())
