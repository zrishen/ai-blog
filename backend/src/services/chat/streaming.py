"""SSE 流式协议层：marker 定义 + partial-JSON 增量解析（工具参数边生成边抽取供前端渲染）。"""

import json
import re

_DONE_MARKER = chr(0)
_BLOGSTART_MARKER = f"{_DONE_MARKER}BLOGSTART{_DONE_MARKER}"
_BLOGDELTA_MARKER = f"{_DONE_MARKER}BLOGDELTA{_DONE_MARKER}"
_REASONING_MARKER = f"{_DONE_MARKER}REASONING{_DONE_MARKER}"
_ROUNDDELTA_MARKER = f"{_DONE_MARKER}ROUNDDELTA{_DONE_MARKER}"
_ROUNDEND_MARKER = f"{_DONE_MARKER}ROUNDEND{_DONE_MARKER}"
_STREAMERROR_MARKER = f"{_DONE_MARKER}STREAMERROR{_DONE_MARKER}"
_PATCHSTART_MARKER = f"{_DONE_MARKER}PATCHSTART{_DONE_MARKER}"
_PATCHDELTA_MARKER = f"{_DONE_MARKER}PATCHDELTA{_DONE_MARKER}"
_TOOLPREP_MARKER = f"{_DONE_MARKER}TOOLPREP{_DONE_MARKER}"


def _compact_json(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _extract_partial_int(args_json: str, field: str) -> int | None:
    """从 partial JSON args 中提取已完整生成的非负整数字段。"""
    match = re.search(rf'"{re.escape(field)}"\s*:\s*(\d+)(?=\s*[,}}])', args_json)
    return int(match.group(1)) if match else None


def _extract_partial_content(args_json: str) -> str | None:
    """从 partial JSON args 中提取 content 字段的值（已生成部分）。"""
    match = re.search(r'"content"\s*:\s*"', args_json)
    if not match:
        return None
    start = match.end()
    i = start
    result: list[str] = []
    while i < len(args_json):
        ch = args_json[i]
        if ch == "\\" and i + 1 < len(args_json):
            next_ch = args_json[i + 1]
            if next_ch == '"':
                result.append('"')
            elif next_ch == "\\":
                result.append("\\")
            elif next_ch == "n":
                result.append("\n")
            elif next_ch == "t":
                result.append("\t")
            else:
                result.append(next_ch)
            i += 2
        elif ch == '"':
            return "".join(result)
        else:
            result.append(ch)
            i += 1
    return "".join(result)


def _extract_partial_json_string(args_json: str, field: str) -> str | None:
    """从 partial JSON args 中提取指定字符串字段的值（转义处理同 _extract_partial_content）。"""
    match = re.search(rf'"{field}"\s*:\s*"', args_json)
    if not match:
        return None
    start = match.end()
    i = start
    result: list[str] = []
    while i < len(args_json):
        ch = args_json[i]
        if ch == "\\":
            if i + 1 >= len(args_json):
                break
            next_ch = args_json[i + 1]
            if next_ch == '"':
                result.append('"')
                i += 2
            elif next_ch == "\\":
                result.append("\\")
                i += 2
            elif next_ch == "n":
                result.append("\n")
                i += 2
            elif next_ch == "r":
                result.append("\r")
                i += 2
            elif next_ch == "t":
                result.append("\t")
                i += 2
            elif next_ch == "b":
                result.append("\b")
                i += 2
            elif next_ch == "f":
                result.append("\f")
                i += 2
            elif next_ch == "/":
                result.append("/")
                i += 2
            elif next_ch == "u":
                # Tool 参数可在 Unicode escape 任意位置切片，完整解码前不输出破损预览。
                if i + 6 > len(args_json):
                    break
                try:
                    code_point = int(args_json[i + 2:i + 6], 16)
                except ValueError:
                    break
                if 0xD800 <= code_point <= 0xDBFF:
                    if i + 12 > len(args_json) or args_json[i + 6:i + 8] != "\\u":
                        break
                    try:
                        low_surrogate = int(args_json[i + 8:i + 12], 16)
                    except ValueError:
                        break
                    if not 0xDC00 <= low_surrogate <= 0xDFFF:
                        break
                    result.append(chr(0x10000 + ((code_point - 0xD800) << 10) + (low_surrogate - 0xDC00)))
                    i += 12
                else:
                    result.append(chr(code_point))
                    i += 6
            else:
                result.append(next_ch)
                i += 2
        elif ch == '"':
            return "".join(result)
        else:
            result.append(ch)
            i += 1
    return "".join(result)


def _extract_partial_target(args_json: str) -> str | None:
    return _extract_partial_json_string(args_json, "target_text")


def _extract_partial_replacement(args_json: str) -> str | None:
    return _extract_partial_json_string(args_json, "replacement_text")
