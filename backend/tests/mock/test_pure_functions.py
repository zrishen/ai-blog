"""纯函数单元测试 —— 不依赖 DB / IO，锁定核心逻辑不变性。"""

import pytest

from src.services.llm_settings_service import (
    SUPPORTED_LLM_PROTOCOLS,
    build_llm_model_kwargs,
    normalize_llm_protocol,
)
from src.services.markdown_blog_service import normalize_post_body
from src.tools.blog import BLOG_TOOLS
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


def test_blog_tools_expose_read_edit_write_tools():
    names = [tool.name for tool in BLOG_TOOLS]

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
    assert len(names) == 6
