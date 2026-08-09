"""纯函数单元测试 —— 不依赖 DB / IO，锁定核心逻辑不变性。"""

import pytest

from src.prompts import (
    BLOG_MERMAID_GUIDE,
    CORE_TOOL_RULES_TEXT,
    KNOWLEDGE_GRAPH_RULES,
    MEMORY_RECALL_RULES,
    PromptContext,
    RAG_AUTO,
    SIDEBAR_TOOL_RULES,
    SYSTEM_BASE,
    SYSTEM_DATE,
    WRITING_CREATE_TEXT,
    resolve_active_segments,
)
from src.services.infra.llm.llm_factory import _system_prompt
from src.services.infra.llm.llm_settings_service import (
    SUPPORTED_LLM_PROTOCOLS,
    build_llm_model_kwargs,
    normalize_llm_protocol,
)
from src.services.workspace.blog.blog_storage_service import normalize_post_body
from src.tools.registry import tool_names_by_tag
from src.utils.slug import slugify


# ---- slugify ----

@pytest.mark.parametrize("raw, expected", [
    ("Hello World", "hello-world"),
    ("  多余   空格 ", "多余-空格"),
    ("中文__标题", "中文-标题"),
    ("已有-连字符---合并", "已有-连字符-合并"),
    ("去除!@#$%^&*()特殊", "去除特殊"),
    ("", "post"),
    ("   ", "post"),
])
def test_slugify_transforms_text(raw, expected):
    assert slugify(raw) == expected


def test_slugify_truncates_to_200_chars():
    raw = "a" * 300
    result = slugify(raw)
    assert len(result) == 200


# ---- normalize_post_body ----

def test_normalize_post_body_strips_leading_h1_matching_title():
    body = "# 我的标题\n\n正文内容"
    assert normalize_post_body("我的标题", body) == "正文内容"


def test_normalize_post_body_keeps_h1_when_title_differs():
    body = "# 不同标题\n\n正文"
    assert normalize_post_body("我的标题", body) == body


def test_normalize_post_body_only_strips_first_h1():
    body = "# 标题\n# 标题\n正文"
    # 仅移除第一个；后续相同标题保留
    result = normalize_post_body("标题", body)
    assert result == "# 标题\n正文"


def test_normalize_post_body_handles_empty_inputs():
    assert normalize_post_body("", "任何") == "任何"
    assert normalize_post_body("标题", "") == ""


def test_normalize_post_body_does_not_strip_h2_or_h3():
    body = "## 标题\n### 标题\n正文"
    assert normalize_post_body("标题", body) == body


# ---- normalize_llm_protocol ----

def test_normalize_llm_protocol_defaults_to_openai():
    assert normalize_llm_protocol(None) == "openai"
    assert normalize_llm_protocol("") == "openai"


def test_normalize_llm_protocol_lowercases_and_validates():
    assert normalize_llm_protocol("OpenAI") == "openai"
    assert normalize_llm_protocol("  Anthropic  ") == "anthropic"


def test_normalize_llm_protocol_falls_back_for_unknown():
    assert normalize_llm_protocol("gemini") == "openai"
    assert normalize_llm_protocol("anything-else") == "openai"
    # 支持列表中的所有协议都能正确归一化
    for proto in SUPPORTED_LLM_PROTOCOLS:
        assert normalize_llm_protocol(proto.upper()) == proto


# ---- build_llm_model_kwargs ----

def test_build_llm_model_kwargs_strict_mode_returns_none_api_key_without_record():
    kwargs = build_llm_model_kwargs(thinking_mode="balanced", llm_settings=None)
    assert kwargs["protocol"] == "openai"
    assert kwargs["api_key"] is None
    assert kwargs["base_url"] is None
    assert kwargs["model"] is None
    assert kwargs["temperature"] is not None


def test_build_llm_model_kwargs_strict_mode_uses_user_record_api_key():
    from src.database.models import LLMSettings

    record = LLMSettings(
        user_id=1,
        protocol="anthropic",
        base_url="https://example.com",
        api_key="key-xyz",
        model_name="custom-model",
    )
    kwargs = build_llm_model_kwargs(thinking_mode="balanced", llm_settings=record)
    assert kwargs["protocol"] == "anthropic"
    assert kwargs["api_key"] == "key-xyz"
    assert kwargs["base_url"] == "https://example.com"
    assert kwargs["model"] == "custom-model"


def test_build_llm_model_kwargs_official_fallback_uses_env_when_no_record():
    from src.config import settings

    kwargs = build_llm_model_kwargs(
        thinking_mode="balanced", llm_settings=None, allow_official_fallback=True
    )
    assert kwargs["api_key"] == settings.openai_api_key
    assert kwargs["base_url"] == settings.base_url
    assert kwargs["model"] == settings.model_name


def test_build_llm_model_kwargs_maps_thinking_mode_to_reasoning_effort():
    # 默认 model_name 落在支持思考的关键词内（Qwen3），所以应注入 reasoning_effort
    kwargs_fast = build_llm_model_kwargs(
        thinking_mode="fast", llm_settings=None, allow_official_fallback=True
    )
    assert kwargs_fast["reasoning_effort"] == "low"

    kwargs_balanced = build_llm_model_kwargs(
        thinking_mode="balanced", llm_settings=None, allow_official_fallback=True
    )
    assert kwargs_balanced["reasoning_effort"] == "medium"

    kwargs_smart = build_llm_model_kwargs(
        thinking_mode="smart", llm_settings=None, allow_official_fallback=True
    )
    assert kwargs_smart["reasoning_effort"] == "high"


def test_build_llm_model_kwargs_skips_reasoning_effort_for_non_thinking_model():
    from src.database.models import LLMSettings

    custom = LLMSettings(
        user_id=1,
        protocol="openai",
        base_url="https://example.com",
        api_key="key-xyz",
        model_name="legacy-gpt-3.5",
    )
    kwargs = build_llm_model_kwargs(thinking_mode="smart", llm_settings=custom)
    assert "reasoning_effort" not in kwargs


# ---- blog tools ----


def test_blog_prompt_requires_create_then_write_for_new_posts():
    # 1.3：create-before-write 规则迁至 WRITING_CREATE_TEXT（写作段，blog_* 门控）
    assert "先调用 blog_create_post" in WRITING_CREATE_TEXT
    assert "再调用 blog_write_post" in WRITING_CREATE_TEXT
    assert "不得创建草稿后直接结束" in WRITING_CREATE_TEXT


def test_blog_tools_expose_read_edit_write_tools():
    # 1.4：BLOG_TOOLS 退役，写作工具集从 TOOL_REGISTRY.tags 派生（统一工具名源）
    names = tool_names_by_tag("writing")

    assert "blog_read_post" in names
    assert "blog_write_post" in names
    assert "blog_edit_post" in names
    assert "blog_search_posts" in names
    assert "blog_list_posts" not in names
    assert "blog_get_post" not in names
    assert "blog_get_post_outline" not in names
    assert "blog_get_post_section" not in names
    assert "blog_update_post" not in names
    assert "blog_patch_post" not in names
    assert "update_blog_sidebar" in names
    assert len(names) == 7


# ---- PromptSegment 注册表（1.3 prompt 注入）----


def _default_writing_ctx(**overrides):
    """默认写作场景 ctx == orchestrator 真实接线形状（resolve_skills 默认 required+segments）。"""
    from src.services.agent.skill import resolve_skills

    default = resolve_skills()  # DEFAULT_ENABLED_SKILLS：required=writing+base，segments=writing×3
    base = dict(
        user_id=1,
        mounted_tool_names=default.required_tool_names,
        enabled_segments=default.enabled_segment_names,  # 自动跟踪 orchestrator（1.4 writing×3）
    )
    base.update(overrides)
    return PromptContext(**base)


def test_resolve_default_snapshot_segment_names_and_order():
    """默认场景激活段集与 priority 顺序锁定（mcp 因无 cap_text 不激活）。"""
    segments = resolve_active_segments(_default_writing_ctx())
    assert [s.name for s in segments] == [
        "system_base",
        "system_date",
        "core_tool_rules",
        "writing_create_flow",
        "writing_mermaid",
        "writing_sidebar",
        "knowledge_library",
        "memory_recall",
    ]


def test_system_prompt_default_byte_equivalence():
    """_system_prompt 默认输出 == 各段常量按 priority 拼接（逐字节锁定装配 + 渲染）。"""
    today = "2026年08月08日"
    rendered = _system_prompt(resolve_active_segments(_default_writing_ctx()), today=today)
    expected = (
        SYSTEM_BASE
        + SYSTEM_DATE.format(today=today)
        + CORE_TOOL_RULES_TEXT
        + WRITING_CREATE_TEXT
        + BLOG_MERMAID_GUIDE
        + SIDEBAR_TOOL_RULES
        + RAG_AUTO
        + KNOWLEDGE_GRAPH_RULES
        + MEMORY_RECALL_RULES
    )
    assert rendered == expected


def test_system_date_dropped_writing_locator():
    """1.3：SYSTEM_DATE 去'撰写文章时'写作定位词，保留时间线相关性。"""
    assert "撰写文章时" not in SYSTEM_DATE
    assert "时间线" in SYSTEM_DATE


def test_resolve_writing_segments_condition_filters_without_blog_tools():
    """挂非写作工具 → _writing_on=False → 写作三段不激活（condition 双保险；1.5 翻 default_active=False 后仍由 condition 把关）。"""
    ctx = PromptContext(
        user_id=1,
        mounted_tool_names=frozenset({"mcp_call_tool"}),
        enabled_segments=frozenset(),
    )
    names = {s.name for s in resolve_active_segments(ctx)}
    assert "writing_create_flow" not in names
    assert "writing_mermaid" not in names
    assert "writing_sidebar" not in names
    assert "core_tool_rules" in names  # core 仍激活（mounted 非空）
    assert "knowledge_library" not in names  # 无知识库工具


def test_writing_segments_off_when_skill_disabled_but_tools_mounted():
    """1.5-A skill 化核心：writing skill 关闭（enabled_segments 不含写作段）即便工具仍挂载，
    写作指令段也不注入（default_active=False + enabled 不含 → OR 得 False）。

    这是 skill 化的价值：关 skill = 不再向 LLM 注入该领域指令段（工具是否挂载是另一层）。
    翻 default_active=False 前此处会因 default_active=True 而激活，故测试 1.5 同步加。
    """
    ctx = PromptContext(
        user_id=1,
        mounted_tool_names=frozenset({"blog_create_post", "blog_edit_post"}),
        enabled_segments=frozenset(),  # writing skill 关闭
    )
    names = {s.name for s in resolve_active_segments(ctx)}
    assert "writing_create_flow" not in names
    assert "writing_mermaid" not in names
    assert "writing_sidebar" not in names


def test_writing_segments_off_when_skill_enabled_but_tools_not_mounted():
    """1.5-A 双保险：writing skill 启用（enabled_segments 含 writing×3）但工具未挂载
    （mounted_tool_names 无写作工具）→ _writing_on=False → 写作段仍不注入。

    防 skill 声明了写作段、但因 gate off 工具没挂时，仍向 LLM 注入指向未挂载工具的指令。
    """
    ctx = PromptContext(
        user_id=1,
        mounted_tool_names=frozenset({"mcp_call_tool"}),
        enabled_segments=frozenset({"writing_create_flow", "writing_mermaid", "writing_sidebar"}),
    )
    names = {s.name for s in resolve_active_segments(ctx)}
    assert "writing_create_flow" not in names
    assert "writing_mermaid" not in names
    assert "writing_sidebar" not in names


def test_resolve_core_rules_condition_requires_tools():
    """core 段 condition=bool(mounted_tool_names)：无工具 → 不激活；base/date 无条件常驻。"""
    ctx = PromptContext(
        user_id=1,
        mounted_tool_names=frozenset(),
        enabled_segments=frozenset(),
    )
    names = {s.name for s in resolve_active_segments(ctx)}
    assert "core_tool_rules" not in names
    assert "system_base" in names
    assert "system_date" in names
    assert "knowledge_library" not in names


def test_resolve_mcp_segment_condition_requires_cap_text():
    """mcp 段 condition=bool(mcp_capabilities_text)：空不激活，非空激活。"""
    assert "mcp_capabilities" not in {
        s.name for s in resolve_active_segments(_default_writing_ctx(mcp_capabilities_text=""))
    }
    assert "mcp_capabilities" in {
        s.name for s in resolve_active_segments(_default_writing_ctx(mcp_capabilities_text="srv/t"))
    }


def test_resolve_enabled_segments_activates_default_inactive(monkeypatch):
    """OR 语义：default_active=False 的段仅靠 enabled_segments 激活（skill 启用路径）。

    用独立 monkeypatch 段隔离测 OR 的 enabled 分支（写作三段 1.5 已翻 default_active=False，
    见 test_writing_segments_off_when_skill_disabled_*；此处保留独立段测通用 OR 机制，不耦合写作段内容）。
    """
    from src.prompts import PROMPT_SEGMENT_REGISTRY, PromptSegment

    test_seg = PromptSegment("test_skill_only_segment", "X", default_active=False, condition=None)
    monkeypatch.setitem(PROMPT_SEGMENT_REGISTRY, test_seg.name, test_seg)

    base_ctx = dict(user_id=1, mounted_tool_names=frozenset({"blog_create_post"}))
    # 未 enable → 不激活（default_active=False 且不在 enabled_segments）
    ctx_off = PromptContext(enabled_segments=frozenset(), **base_ctx)
    assert test_seg.name not in {s.name for s in resolve_active_segments(ctx_off)}
    # enable → 激活（OR 第二项 True；condition None 放行）
    ctx_on = PromptContext(enabled_segments=frozenset({test_seg.name}), **base_ctx)
    assert test_seg.name in {s.name for s in resolve_active_segments(ctx_on)}
