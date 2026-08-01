"""Token 估算：从消息 content / reasoning block 提取文本，CJK 按 0.5 token、其他按 0.25 token 粗估。"""

from typing import Any


def _extract_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
            text = block.get("text", block.get("content", ""))
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


def _extract_reasoning_content(content: Any) -> str:
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") not in {"thinking", "reasoning"}:
            continue
        text = block.get("thinking", block.get("text", block.get("content", "")))
        if isinstance(text, str):
            parts.append(text)
    return "".join(parts)


def estimate_tokens(text: str | list) -> int:
    if isinstance(text, list):
        text = _extract_text_content(text)
    cjk = sum(1 for c in text if "一" <= c <= "鿿")
    return max(1, (cjk // 2) + ((len(text) - cjk) // 4))
