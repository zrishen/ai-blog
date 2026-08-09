"""Token 估算：从消息 content / reasoning block 提取文本，CJK 按 0.5 token、其他按 0.25 token 粗估。"""

from typing import Any

# 图片块按 base64 大小折算 token（模型对图片按视觉 token 计费，粗略估算）：
# 每张图基础 ~500 token，另按 data 体积 ~每 400 字符 1 token 累加。
_IMAGE_BASE_TOKENS = 500
_IMAGE_BYTES_PER_TOKEN = 400


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


def _estimate_image_tokens(block: dict) -> int:
    """按图片块的 base64 data 长度估算视觉 token。"""
    source = block.get("source") if isinstance(block.get("source"), dict) else {}
    data = source.get("data", "")
    if isinstance(data, str) and data:
        return _IMAGE_BASE_TOKENS + len(data) // _IMAGE_BYTES_PER_TOKEN
    url = block.get("image_url", {})
    if isinstance(url, dict) and isinstance(url.get("url"), str):
        u = url["url"]
        # data: URL 含 base64；普通 URL 无法估算，按基础值
        if u.startswith("data:"):
            return _IMAGE_BASE_TOKENS + len(u) // _IMAGE_BYTES_PER_TOKEN
    return _IMAGE_BASE_TOKENS


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


def estimate_tokens(text: Any) -> int:
    # content 可能是 None（assistant tool_calls 消息）或多模态 list，统一抽成文本再估算；
    # 多模态块中的图片按 base64 大小折算视觉 token，一并计入
    if not isinstance(text, str):
        image_tokens = 0
        if isinstance(text, list):
            for block in text:
                if isinstance(block, dict) and block.get("type") in {"image", "image_url"}:
                    image_tokens += _estimate_image_tokens(block)
        text = _extract_text_content(text)
        cjk = sum(1 for c in text if "一" <= c <= "鿿")
        return max(1, (cjk // 2) + ((len(text) - cjk) // 4)) + image_tokens
    cjk = sum(1 for c in text if "一" <= c <= "鿿")
    return max(1, (cjk // 2) + ((len(text) - cjk) // 4))
