"""Markdown 正文 AST 解析服务：把正文解析成块结构缓存到 DB（blocks_json），供 AI 章节定位（大纲提取/读单节）省 token。

事实源是 blog_posts.content（DB），blocks_json 是派生缓存，可随时从 content 重建。
"""

import logging
from typing import Optional

from markdown_it import MarkdownIt

logger = logging.getLogger(__name__)

# commonmark 模式:标准 markdown 语法,代码块内的 # 不会被误判为标题
_md = MarkdownIt("commonmark")


def parse_to_blocks(body: str) -> list[dict]:
    """把 Markdown 正文解析成块数组。

    块结构：{"type": "heading"|"paragraph"|"code"|"list"|"quote"|"other", "level", "text", "content", "lang", "char_count"}；
    解析失败返回空列表（调用方应降级为读全文）。
    """
    if not body or not body.strip():
        return []

    lines = body.split("\n")
    try:
        tokens = _md.parse(body)
    except Exception:
        logger.warning("Markdown AST 解析失败,降级为空 blocks", exc_info=True)
        return []

    blocks: list[dict] = []
    i = 0
    while i < len(tokens):
        token = tokens[i]

        if token.type == "heading_open" and token.map:
            start, end = token.map
            # 下一个 token 是 inline(标题文字)
            inline_token = tokens[i + 1] if i + 1 < len(tokens) else None
            text = (inline_token.content if inline_token and inline_token.type == "inline" else "").strip()
            content = "\n".join(lines[start:end]).rstrip()
            blocks.append({
                "type": "heading",
                "level": int(token.tag[1:]) if token.tag.startswith("h") else 2,
                "text": text,
                "content": content,
                "lang": "",
                "char_count": len(text),
            })
            i += 3  # heading_open + inline + heading_close
            continue

        if token.type == "paragraph_open" and token.map:
            start, end = token.map
            inline_token = tokens[i + 1] if i + 1 < len(tokens) else None
            text = (inline_token.content if inline_token and inline_token.type == "inline" else "").strip()
            content = "\n".join(lines[start:end]).rstrip()
            blocks.append({
                "type": "paragraph",
                "level": 0,
                "text": text[:120],  # 摘要截断
                "content": content,
                "lang": "",
                "char_count": len(text),
            })
            i += 3  # paragraph_open + inline + paragraph_close
            continue

        if token.type in ("fence", "code_block") and token.map:
            start, end = token.map
            content = "\n".join(lines[start:end]).rstrip()
            blocks.append({
                "type": "code",
                "level": 0,
                "text": token.content.strip()[:120],
                "content": content,
                "lang": token.info.strip() if token.type == "fence" else "",
                "char_count": len(token.content.strip()),
            })
            i += 1
            continue

        if token.type in ("bullet_list_open", "ordered_list_open") and token.map:
            start, end = token.map
            content = "\n".join(lines[start:end]).rstrip()
            items = _extract_list_items(tokens, i)
            text = "; ".join(items)[:120]
            blocks.append({
                "type": "list",
                "level": 0,
                "text": text,
                "content": content,
                "lang": "",
                "char_count": len(text),
            })
            i = _skip_list(tokens, i)
            continue

        if token.type == "blockquote_open" and token.map:
            start, end = token.map
            content = "\n".join(lines[start:end]).rstrip()
            inline_text = _collect_inline_until(tokens, i + 1, "blockquote_close")
            blocks.append({
                "type": "quote",
                "level": 0,
                "text": inline_text[:120],
                "content": content,
                "lang": "",
                "char_count": len(inline_text),
            })
            i = _skip_until_close(tokens, i, "blockquote_open", "blockquote_close")
            continue

        # 其他未识别的 token(如 hr、html_block)——尝试用 map 保留
        if token.map:
            start, end = token.map
            content = "\n".join(lines[start:end]).rstrip()
            if content:
                blocks.append({
                    "type": "other",
                    "level": 0,
                    "text": content[:120],
                    "content": content,
                    "lang": "",
                    "char_count": len(content),
                })
        i += 1

    return blocks


def _extract_list_items(tokens: list, list_open_idx: int) -> list[str]:
    """从列表 token 流中提取各 item 的纯文字。"""
    items: list[str] = []
    close_tag = "bullet_list_close" if tokens[list_open_idx].type == "bullet_list_open" else "ordered_list_close"
    depth = 0
    j = list_open_idx + 1
    while j < len(tokens):
        t = tokens[j]
        if t.type in ("bullet_list_open", "ordered_list_open"):
            depth += 1
        elif t.type in ("bullet_list_close", "ordered_list_close"):
            if depth == 0 and t.type == close_tag:
                break
            depth -= 1
        elif t.type == "inline" and depth <= 1:
            items.append(t.content.strip())
        j += 1
    return items


def _skip_list(tokens: list, list_open_idx: int) -> int:
    """跳过整个列表(匹配 open/close),返回 close 之后的索引。"""
    depth = 0
    j = list_open_idx
    while j < len(tokens):
        t = tokens[j]
        if t.type in ("bullet_list_open", "ordered_list_open"):
            depth += 1
        elif t.type in ("bullet_list_close", "ordered_list_close"):
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return j + 1


def _collect_inline_until(tokens: list, start: int, close_type: str) -> str:
    """收集从 start 到 close_type 之前的所有 inline 文字。"""
    parts: list[str] = []
    depth = 0
    j = start
    while j < len(tokens):
        t = tokens[j]
        if t.type.endswith("_open"):
            depth += 1
        elif t.type.endswith("_close"):
            if depth == 0:
                break
            depth -= 1
        elif t.type == "inline":
            parts.append(t.content.strip())
        j += 1
    return " ".join(parts)


def _skip_until_close(tokens: list, start: int, open_type: str, close_type: str) -> int:
    """跳过 open_type...close_type 配对,返回 close 之后的索引。"""
    depth = 0
    j = start
    while j < len(tokens):
        t = tokens[j]
        if t.type == open_type:
            depth += 1
        elif t.type == close_type:
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return j + 1


# ── 大纲 / 章节定位 ──


def extract_outline(blocks: list[dict]) -> list[dict]:
    """从块数组提取标题大纲（只含 heading 块）。

    返回 {"section_index"(从 1 开始), "level", "title", "char_count", "first_sentence"} 列表；无 heading 返回空列表。
    """
    outline: list[dict] = []
    for idx, block in enumerate(blocks):
        if block["type"] != "heading":
            continue
        section_index = len(outline) + 1
        char_count = _section_char_count(blocks, idx)
        first_sentence = _section_first_sentence(blocks, idx)
        outline.append({
            "section_index": section_index,
            "level": block["level"],
            "title": block["text"],
            "char_count": char_count,
            "first_sentence": first_sentence,
        })
    return outline


def _section_char_count(blocks: list[dict], heading_idx: int) -> int:
    """计算某 heading 下到下一个同级/高级 heading 之间的字数(含 heading 自身)。"""
    base_level = blocks[heading_idx]["level"]
    total = blocks[heading_idx]["char_count"]
    for block in blocks[heading_idx + 1:]:
        if block["type"] == "heading" and block["level"] <= base_level:
            break
        total += block["char_count"]
    return total


def _section_first_sentence(blocks: list[dict], heading_idx: int) -> str:
    """取某 heading 下第一个非 heading 块的首句文字。"""
    base_level = blocks[heading_idx]["level"]
    for block in blocks[heading_idx + 1:]:
        if block["type"] == "heading" and block["level"] <= base_level:
            break
        if block["type"] in ("paragraph", "list", "quote"):
            return block["text"][:60]
    return ""


def get_section_text(blocks: list[dict], section_index: int) -> Optional[str]:
    """按大纲序号（从 1 开始）返回该节的完整 markdown 文字；序号无效或无 heading 返回 None。"""
    headings = [(idx, b) for idx, b in enumerate(blocks) if b["type"] == "heading"]
    if section_index < 1 or section_index > len(headings):
        return None

    start_idx, heading_block = headings[section_index - 1]
    base_level = heading_block["level"]
    parts = [heading_block["content"]]
    for block in blocks[start_idx + 1:]:
        if block["type"] == "heading" and block["level"] <= base_level:
            break
        parts.append(block["content"])
    return "\n\n".join(p for p in parts if p)


def get_section_char_range(body: str, blocks: list[dict], section_index: int) -> Optional[tuple[int, int]]:
    """返回章节文本在 body 中的字符范围 [start, end)，用于 blog_edit_post 把 target_text 搜索限定在单章节内。

    实现：get_section_text 结果在 body 中正向定位一次，end = start + len(section_text)；无法定位返回 None。
    """
    section_text = get_section_text(blocks, section_index)
    if not section_text:
        return None
    start = body.find(section_text)
    if start < 0:
        return None
    return start, start + len(section_text)
