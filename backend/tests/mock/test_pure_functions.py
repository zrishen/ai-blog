"""纯函数单元测试 —— 不依赖 DB / IO，锁定核心逻辑不变性。"""

import pytest

from src.services.llm_settings_service import (
    SUPPORTED_LLM_PROTOCOLS,
    build_llm_model_kwargs,
    normalize_llm_protocol,
)
from src.services.markdown_blog_service import normalize_post_body
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

def test_build_llm_model_kwargs_uses_settings_defaults_when_no_record():
    from src.config import settings

    kwargs = build_llm_model_kwargs(thinking_mode="normal", llm_settings=None)
    assert kwargs["protocol"] == "openai"
    assert kwargs["api_key"] == settings.openai_api_key
    assert kwargs["base_url"] == settings.base_url
    assert kwargs["model"] == settings.model_name
    assert kwargs["temperature"] == settings.model_temperature


def test_build_llm_model_kwargs_deep_mode_overrides_temperature_and_tokens():
    from src.config import settings

    kwargs = build_llm_model_kwargs(thinking_mode="deep", llm_settings=None)
    assert kwargs["temperature"] == settings.deep_thinking_temperature
    assert kwargs["max_tokens"] == settings.deep_thinking_max_output_tokens


def test_build_llm_model_kwargs_custom_settings_override_defaults():
    from src.database.models import LLMSettings

    record = LLMSettings(
        user_id=1,
        protocol="anthropic",
        base_url="https://example.com",
        api_key="key-xyz",
        model_name="custom-model",
    )
    kwargs = build_llm_model_kwargs(thinking_mode="normal", llm_settings=record)
    assert kwargs["protocol"] == "anthropic"
    assert kwargs["api_key"] == "key-xyz"
    assert kwargs["base_url"] == "https://example.com"
    assert kwargs["model"] == "custom-model"
