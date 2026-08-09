"""工具装配唯一入口 assemble_tools + ToolProvider 协议。

替换 orchestrator 硬编码 append。装配 = 静态领域工具（TOOL_REGISTRY 查表 + gate）
+ 动态平台工具（_PROVIDERS.provide）。行为等价现状：blog_7 + base_search_file + 条件
base_recall_memory(memory_enabled) + 条件 mcp_call_tool(mcp_plugins 非空)。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

from langchain_core.tools import BaseTool

from src.config import settings
from src.tools.mcp import build_mcp_call_tool, normalize_mcp_capabilities
from src.tools.registry import TOOL_REGISTRY
from src.tools.web import web_fetch, web_search
from src.tools.workspace_files import (
    workspace_delete_file,
    workspace_edit_file,
    workspace_git_diff,
    workspace_git_history,
    workspace_git_restore_file,
    workspace_git_status,
    workspace_glob,
    workspace_grep,
    workspace_move_file,
    workspace_read_file,
    workspace_write_file,
)

if TYPE_CHECKING:
    from src.services.agent.skill.context import SkillContext
    from src.tools.behavior import ToolBehaviorDescriptor

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ToolFeatureFlags:
    memory_enabled: bool
    web_tools_enabled: bool = False
    workspace_files_enabled: bool = False  # WorkspaceFilesProvider
    code_execution_enabled: bool = False   # CodeExecutionProvider

    @classmethod
    def from_settings(cls) -> "ToolFeatureFlags":
        return cls(
            memory_enabled=settings.memory_enabled,
            web_tools_enabled=settings.web_tools_enabled,
            workspace_files_enabled=settings.workspace_files_enabled,
        )


@dataclass(frozen=True)
class ToolContext:
    user_id: int
    skill: "SkillContext"
    mcp_plugins: tuple[dict, ...]
    feature_flags: ToolFeatureFlags


@dataclass(frozen=True)
class AssembleResult:
    tools: list[BaseTool]
    mounted_tool_names: frozenset[str]
    behaviors: dict[str, "ToolBehaviorDescriptor"] = field(default_factory=dict)


class ToolProvider(Protocol):
    """动态/平台工具提供者（mcp/web/workspace_files/code）；领域工具走 TOOL_REGISTRY 不实现此协议。"""

    name: str

    def provide(self, ctx: ToolContext) -> list[BaseTool]: ...


class McpToolProvider:
    name = "mcp"

    def provide(self, ctx: ToolContext) -> list[BaseTool]:
        plugins = list(ctx.mcp_plugins)
        if not plugins:
            return []
        # 复刻现状 `if mcp_capabilities:`：按 normalize 后能力判空——插件存在但能力为空
        # （全 is_published=False / 缺 slug 或 name / 无 tools）则不挂，避免退化 mcp_call_tool
        capabilities = normalize_mcp_capabilities(plugins)
        if not capabilities:
            return []
        return [build_mcp_call_tool(plugins, capabilities)]


class WebToolProvider:
    name = "web"

    def provide(self, ctx: ToolContext) -> list[BaseTool]:
        if not ctx.feature_flags.web_tools_enabled:
            return []
        return [web_search, web_fetch]


class WorkspaceFilesProvider:
    name = "workspace_files"

    def provide(self, ctx: ToolContext) -> list[BaseTool]:
        if not ctx.feature_flags.workspace_files_enabled:
            return []
        return [
            workspace_read_file,
            workspace_write_file,
            workspace_edit_file,
            workspace_glob,
            workspace_grep,
            workspace_move_file,
            workspace_delete_file,
            workspace_git_status,
            workspace_git_history,
            workspace_git_diff,
            workspace_git_restore_file,
        ]


# 固定序；预留槽：WorkspaceFilesProvider / CodeExecutionProvider
_PROVIDERS: tuple[ToolProvider, ...] = (McpToolProvider(), WorkspaceFilesProvider(), WebToolProvider())


def assemble_tools(
    ctx: ToolContext, behaviors: dict[str, "ToolBehaviorDescriptor"] | None = None
) -> AssembleResult:
    """唯一装配入口，替换 orchestrator 硬编码。

    (1) 校验 required_tool_names 全登记（未登记 → ValueError fail loud）；
    (2) 遍历 TOOL_REGISTRY（dict 保序）：名 in required_tool_names 且过 gate → 挂载，gate off → silent skip
        （memory_enabled=False 属预期降级，不告警；仅未登记名才 fail loud）；
    (3) 遍历 _PROVIDERS.provide(ctx)（固定序）追加动态工具；
    (4) 按名去重（首现保留，跨源同名 warning）；
    (5) 返回 tools + mounted_tool_names（名集合，喂 PromptContext 门控）。
    """
    required = ctx.skill.required_tool_names
    unknown = set(required) - TOOL_REGISTRY.keys()
    if unknown:
        raise ValueError(f"required_tool_names 含未登记工具: {sorted(unknown)}")

    tools: list[BaseTool] = []
    seen: set[str] = set()
    for name, spec in TOOL_REGISTRY.items():
        if name not in required:
            continue
        if spec.gate is not None and not spec.gate(ctx):
            continue
        if spec.tool.name in seen:
            logger.warning("重复工具名 %s 跳过（registry）", spec.tool.name)
            continue
        tools.append(spec.tool)
        seen.add(spec.tool.name)

    for provider in _PROVIDERS:
        for tool in provider.provide(ctx):
            if tool.name in seen:
                logger.warning("重复工具名 %s 跳过（provider=%s）", tool.name, provider.name)
                continue
            tools.append(tool)
            seen.add(tool.name)

    # 行为描述符按已挂载名过滤——mcp_call_tool 等动态工具的 behavior 同样经此收割
    beh_table = behaviors or {}
    mounted_behaviors = {name: beh_table[name] for name in seen if name in beh_table}

    return AssembleResult(
        tools=tools,
        mounted_tool_names=frozenset(seen),
        behaviors=mounted_behaviors,
    )
