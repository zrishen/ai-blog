"""Skill 目录与用户 skill 设置的请求/响应模型。"""

from pydantic import BaseModel, ConfigDict, Field


class SkillSummary(BaseModel):
    """前端展示用的 skill 概要（不暴露 required_tool_tag/enabled_segment_names）。"""

    id: str
    name: str
    description: str


class SkillListResponse(BaseModel):
    skills: list[SkillSummary]


class SkillSettingsResponse(BaseModel):
    enabled_skills: list[str]


class SkillSettingsUpdate(BaseModel):
    """PUT /settings/skills 请求体。enabled_skills 必填（空数组 = 显式全关）。"""

    enabled_skills: list[str] = Field(default_factory=list)
    model_config = ConfigDict(extra="forbid")
