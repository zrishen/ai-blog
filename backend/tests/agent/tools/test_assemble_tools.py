"""assemble_tools 行为等价单测：装配集 == 现状硬编码
（blog_7 + base_search_file + 条件 base_recall_memory + 条件 mcp_call_tool），顺序保现状。
"""
import pytest

from src.services.agent.skill.context import SkillContext
from src.tools.provider import (
    McpToolProvider,
    ToolContext,
    ToolFeatureFlags,
    WebToolProvider,
    WorkspaceFilesProvider,
    assemble_tools,
)
from src.tools.registry import TOOL_REGISTRY, tool_names_by_tag

# 1.4：从 TOOL_REGISTRY 派生（统一工具名源，消灭字面量副本；BLOG_TOOLS 已退役）
BLOG_7 = tool_names_by_tag("writing")
KNOWLEDGE_TOOLS = tool_names_by_tag("knowledge")
MEMORY_TOOLS = tool_names_by_tag("memory")
_DEFAULT_REQUIRED = BLOG_7 | KNOWLEDGE_TOOLS | MEMORY_TOOLS | tool_names_by_tag("base")

# 装配顺序 = TOOL_REGISTRY 中 required 的插入序（assemble_tools 遍历 registry 保序 == 旧 agent_tools）
_EXPECTED_ORDER = [name for name in TOOL_REGISTRY if name in _DEFAULT_REQUIRED]


def _ctx(
    *,
    memory_enabled=True,
    web_tools_enabled=False,
    workspace_files_enabled=False,
    mcp_enabled=False,
    mcp_plugins=(),
    required=None,
) -> ToolContext:
    return ToolContext(
        user_id=1,
        skill=SkillContext(
            required_tool_names=required if required is not None else _DEFAULT_REQUIRED,
            enabled_segment_names=frozenset(),
        ),
        mcp_plugins=tuple(mcp_plugins),
        feature_flags=ToolFeatureFlags(
            memory_enabled=memory_enabled,
            web_tools_enabled=web_tools_enabled,
            workspace_files_enabled=workspace_files_enabled,
            mcp_enabled=mcp_enabled,
        ),
    )


def test_assemble_replicates_current_tools_default():
    """默认（memory on、无 mcp）：9 工具，顺序保现状。"""
    asm = assemble_tools(_ctx())
    assert [t.name for t in asm.tools] == _EXPECTED_ORDER
    assert asm.mounted_tool_names == set(_EXPECTED_ORDER)


def test_memory_gate_off_skips_recall():
    """memory_enabled=False → base_recall_memory 被 gate skip；无 gate 工具不受影响。"""
    asm = assemble_tools(_ctx(memory_enabled=False))
    names = {t.name for t in asm.tools}
    assert "base_recall_memory" not in names
    assert "knowledge_query_graph" not in names
    assert "base_search_file" in names
    assert BLOG_7 <= names


def test_mcp_off_when_no_plugins():
    asm = assemble_tools(_ctx(mcp_plugins=()))
    assert "mcp_call_tool" not in asm.mounted_tool_names


def test_mcp_on_when_plugins_present():
    plugins = [{"slug": "p", "name": "P", "is_published": True,
                "tools": [{"name": "t", "input_schema": {"type": "object", "properties": {}}}]}]
    asm = assemble_tools(_ctx(mcp_enabled=True, mcp_plugins=plugins))
    assert "mcp_call_tool" in asm.mounted_tool_names
    # mcp_call_tool 追加在末尾（保现状序）
    assert asm.tools[-1].name == "mcp_call_tool"


def test_mcp_off_when_flag_disabled():
    """mcp_enabled=False（默认停用）→ 即使有启用插件也不挂 mcp_call_tool。"""
    plugins = [{"slug": "p", "name": "P", "is_published": True,
                "tools": [{"name": "t", "input_schema": {"type": "object", "properties": {}}}]}]
    asm = assemble_tools(_ctx(mcp_plugins=plugins))
    assert "mcp_call_tool" not in asm.mounted_tool_names


def test_unknown_required_tool_raises():
    """required_tool_names 含 registry 未登记名 → ValueError fail loud。"""
    with pytest.raises(ValueError):
        assemble_tools(_ctx(required=_DEFAULT_REQUIRED | {"nonexistent_tool"}))


def test_mcp_provider_empty_when_no_plugins():
    assert McpToolProvider().provide(_ctx(mcp_plugins=())) == []


def test_web_provider_is_feature_gated():
    assert WebToolProvider().provide(_ctx()) == []
    assert [tool.name for tool in WebToolProvider().provide(_ctx(web_tools_enabled=True))] == [
        "web_search",
        "web_fetch",
    ]


def test_web_tools_append_after_registry_tools_when_enabled():
    asm = assemble_tools(_ctx(web_tools_enabled=True))
    assert [tool.name for tool in asm.tools][-2:] == ["web_search", "web_fetch"]


def test_workspace_file_provider_is_feature_gated():
    assert WorkspaceFilesProvider().provide(_ctx()) == []
    assert [tool.name for tool in WorkspaceFilesProvider().provide(_ctx(workspace_files_enabled=True))] == [
        "read",
        "write",
        "edit",
        "create_folder",
        "glob",
        "grep",
        "move",
        "delete",
        "git",
    ]


def test_workspace_tools_append_before_web_tools_when_enabled():
    asm = assemble_tools(_ctx(workspace_files_enabled=True, web_tools_enabled=True))
    assert [tool.name for tool in asm.tools][-11:] == [
        "read",
        "write",
        "edit",
        "create_folder",
        "glob",
        "grep",
        "move",
        "delete",
        "git",
        "web_search",
        "web_fetch",
    ]


def test_mcp_skipped_when_plugins_have_no_capabilities():
    """插件存在但 normalize 后能力为空（is_published=False）→ 不挂 mcp_call_tool（复刻现状 if mcp_capabilities）。"""
    plugins = [{"slug": "p", "name": "P", "is_published": False,
                "tools": [{"name": "t", "input_schema": {"type": "object", "properties": {}}}]}]
    asm = assemble_tools(_ctx(mcp_plugins=plugins))
    assert "mcp_call_tool" not in asm.mounted_tool_names


def test_mcp_skipped_when_plugin_lacks_slug():
    """插件缺 slug → normalize 丢弃 → 能力为空 → 不挂。"""
    plugins = [{"name": "P", "is_published": True, "tools": [{"name": "t"}]}]
    asm = assemble_tools(_ctx(mcp_plugins=plugins))
    assert "mcp_call_tool" not in asm.mounted_tool_names


def test_selective_mount_only_required_subset():
    """required_tool_names 子集 → 仅挂载该子集（锁定 1.4 skill 选择性挂载接入点基线）。"""
    asm = assemble_tools(_ctx(required=frozenset({"base_search_file"})))
    assert [t.name for t in asm.tools] == ["base_search_file"]
    assert asm.mounted_tool_names == {"base_search_file"}
    assert not (BLOG_7 & asm.mounted_tool_names)


def test_dedup_provider_collision_keeps_registry_first(monkeypatch, caplog):
    """provider 返回与 registry 同名工具 → 保留 registry 首现，provider 副本 skip + warning（§3 first-wins）。"""
    from langchain_core.tools import StructuredTool
    from src.tools import provider as provider_mod

    def _noop():
        return ""

    colliding = StructuredTool.from_function(_noop, name="blog_create_post", description="collision")

    class CollidingProvider:
        name = "colliding"
        def provide(self, ctx):
            return [colliding]

    monkeypatch.setattr(provider_mod, "_PROVIDERS", (CollidingProvider(),))
    with caplog.at_level("WARNING", logger="src.tools.provider"):
        asm = assemble_tools(_ctx())
    names = [t.name for t in asm.tools]
    assert names.count("blog_create_post") == 1
    assert any("blog_create_post" in r.message for r in caplog.records)
