import pytest

from src.config import settings
from src.services.memory import extractor
from src.services.memory.extractor import _parse, extract


class _FakeLLM:
    def __init__(self, content: str):
        self._content = content
        self.messages = None

    async def ainvoke(self, messages):
        self.messages = messages
        return _FakeResp(self._content)


class _FakeResp:
    def __init__(self, content: str):
        self.content = content


def test_default_extract_depth_is_deep():
    """Fact 是大脑时序记忆核心，默认必须 deep 才会产出 Fact。"""
    assert settings.memory_extract_depth == "deep"


@pytest.mark.asyncio
async def test_extract_default_uses_deep_prompt(monkeypatch):
    monkeypatch.setattr(settings, "memory_extract_depth", "deep")
    llm = _FakeLLM('{"entities":[],"facts":[],"episodes":[]}')

    await extract("text", llm)

    human = llm.messages[1].content
    assert "深度抽取" in human
    assert "facts" in human
    assert "preferences" in human


@pytest.mark.asyncio
async def test_extract_light_omits_fact_instruction(monkeypatch):
    monkeypatch.setattr(settings, "memory_extract_depth", "light")
    llm = _FakeLLM('{"entities":[],"facts":[],"episodes":[]}')

    await extract("text", llm)

    human = llm.messages[1].content
    assert "不必抽事实" in human


@pytest.mark.asyncio
async def test_extract_returns_empty_on_llm_failure(monkeypatch):
    class BoomLLM:
        async def ainvoke(self, messages):
            raise RuntimeError("llm down")

    result = await extract("text", BoomLLM())
    assert result == {"entities": [], "facts": [], "episodes": [], "preferences": []}


def test_parse_tolerates_json_fence_and_extra_text():
    parsed = _parse('noise ```json {"entities":[{"name":"X"}],"facts":[],"episodes":[]}``` tail')
    assert parsed["entities"] == [{"name": "X"}]
    assert parsed["facts"] == []


def test_parse_returns_empty_on_invalid_json():
    assert _parse("not json") == {"entities": [], "facts": [], "episodes": [], "preferences": []}


def test_extractor_module_reexports_extract():
    assert extractor.extract is extract
