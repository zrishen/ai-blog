"""Markdown AST 解析服务测试。"""

from src.services.markdown.markdown_ast_service import (
    parse_to_blocks,
    extract_outline,
    get_section_text,
    get_section_char_range,
)


SAMPLE = """## 第一章 引言

这是引言段落，介绍背景。

### 背景

背景说明文字。

```python
## 这不是标题是代码注释
x = 1
```

## 第二章 核心

核心内容说明。

- 要点一
- 要点二

## 总结

综上所述。
"""


def test_parse_to_blocks_basic_types():
    """解析出 heading / paragraph / code / list 四种块类型。"""
    blocks = parse_to_blocks(SAMPLE)
    types = [b["type"] for b in blocks]
    assert "heading" in types
    assert "paragraph" in types
    assert "code" in types
    assert "list" in types


def test_code_block_hash_not_heading():
    """代码块内的 ## 不被误判为 heading。"""
    blocks = parse_to_blocks(SAMPLE)
    code_blocks = [b for b in blocks if b["type"] == "code"]
    assert len(code_blocks) == 1
    assert "## 这不是标题是代码注释" in code_blocks[0]["content"]
    # heading 里不应该出现代码注释
    headings = [b["text"] for b in blocks if b["type"] == "heading"]
    assert "这不是标题是代码注释" not in headings


def test_heading_level():
    """heading 的 level 正确(h2=2, h3=3)。"""
    blocks = parse_to_blocks(SAMPLE)
    headings = [b for b in blocks if b["type"] == "heading"]
    levels = {b["text"]: b["level"] for b in headings}
    assert levels["第一章 引言"] == 2
    assert levels["背景"] == 3
    assert levels["第二章 核心"] == 2
    assert levels["总结"] == 2


def test_code_lang():
    """代码块的 lang 字段正确。"""
    blocks = parse_to_blocks(SAMPLE)
    code_block = next(b for b in blocks if b["type"] == "code")
    assert code_block["lang"] == "python"


def test_extract_outline():
    """大纲提取:序号、标题、字数、首句。"""
    blocks = parse_to_blocks(SAMPLE)
    outline = extract_outline(blocks)
    assert len(outline) == 4  # 第一章/背景/第二章/总结

    # 序号从 1 开始
    assert outline[0]["section_index"] == 1
    assert outline[0]["title"] == "第一章 引言"
    # 首句正确
    assert "引言段落" in outline[0]["first_sentence"]
    # 字数 > 0
    assert outline[0]["char_count"] > 0


def test_get_section_text_by_index():
    """按序号读取单节内容。"""
    blocks = parse_to_blocks(SAMPLE)
    # section 1 = 第一章(含子标题"背景"和代码块)
    s1 = get_section_text(blocks, 1)
    assert s1 is not None
    assert "第一章 引言" in s1
    assert "引言段落" in s1
    assert "背景说明" in s1  # 子标题内容
    assert "x = 1" in s1  # 代码块

    # section 3 = 第二章(含列表)
    s3 = get_section_text(blocks, 3)
    assert s3 is not None
    assert "第二章 核心" in s3
    assert "要点一" in s3


def test_get_section_text_invalid_index():
    """无效序号返回 None。"""
    blocks = parse_to_blocks(SAMPLE)
    assert get_section_text(blocks, 0) is None
    assert get_section_text(blocks, 99) is None


def test_no_heading_article():
    """无标题文章:大纲为空。"""
    body = "这是一段没有标题的纯文本内容。"
    blocks = parse_to_blocks(body)
    outline = extract_outline(blocks)
    assert outline == []


def test_empty_body():
    """空正文:返回空 blocks。"""
    assert parse_to_blocks("") == []
    assert parse_to_blocks("   ") == []


def test_get_section_char_range_locates_section_text():
    """章节范围起点对齐 section_text 在 body 中的实际位置。"""
    blocks = parse_to_blocks(SAMPLE)
    char_range = get_section_char_range(SAMPLE, blocks, 3)
    assert char_range is not None
    start, end = char_range
    assert SAMPLE[start:end].startswith("## 第二章 核心")
    assert "要点一" in SAMPLE[start:end]
    assert "引言" not in SAMPLE[start:end]


def test_get_section_char_range_invalid_index():
    """越界序号返回 None。"""
    blocks = parse_to_blocks(SAMPLE)
    assert get_section_char_range(SAMPLE, blocks, 0) is None
    assert get_section_char_range(SAMPLE, blocks, 99) is None
