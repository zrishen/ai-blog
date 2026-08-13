"""Skill 目录端点（只读，从 SKILL_REGISTRY 投影）。"""

from fastapi import APIRouter, Depends

from src.database.models import User
from src.schemas.skills import SkillListResponse, SkillSummary
from src.services.agent.skill.settings_service import list_skill_descriptors
from src.utils.auth import get_current_user

router = APIRouter()


@router.get("/skills", response_model=SkillListResponse)
async def list_skills(
    user: User = Depends(get_current_user),
) -> SkillListResponse:
    del user
    return SkillListResponse(
        skills=[SkillSummary(id=d.id, name=d.name, description=d.description) for d in list_skill_descriptors()]
    )
