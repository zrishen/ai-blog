// 流式协议帧原语：marker 常量、定位/剥离/完整性判断。
// marker 值 = null-byte + 名称 + null-byte，用 String.fromCharCode(0) 构造，避免源码里的 \0 字面。

const NUL = String.fromCharCode(0);

export const _TOOL_MARKER = NUL + "TOOLDONE" + NUL;
export const _DONE_MARKER = NUL + "DONE" + NUL;
export const _BLOGSTART_MARKER = NUL + "BLOGSTART" + NUL;
export const _BLOGDELTA_MARKER = NUL + "BLOGDELTA" + NUL;
export const _REASONING_MARKER = NUL + "REASONING" + NUL;
export const _LOOPSTEP_MARKER = NUL + "LOOPSTEP" + NUL;
export const _ROUNDDELTA_MARKER = NUL + "ROUNDDELTA" + NUL;
export const _ROUNDEND_MARKER = NUL + "ROUNDEND" + NUL;
export const _STREAMERROR_MARKER = NUL + "STREAMERROR" + NUL;
export const _PATCHSTART_MARKER = NUL + "PATCHSTART" + NUL;
export const _PATCHDELTA_MARKER = NUL + "PATCHDELTA" + NUL;
export const _TOOLPREP_MARKER = NUL + "TOOLPREP" + NUL;

export const _PROTOCOL_MARKERS = [
  ["REASONING", _REASONING_MARKER],
  ["TOOLDONE", _TOOL_MARKER],
  ["TOOLPREP", _TOOLPREP_MARKER],
  ["BLOGSTART", _BLOGSTART_MARKER],
  ["BLOGDELTA", _BLOGDELTA_MARKER],
  ["PATCHSTART", _PATCHSTART_MARKER],
  ["PATCHDELTA", _PATCHDELTA_MARKER],
  ["LOOPSTEP", _LOOPSTEP_MARKER],
  ["ROUNDDELTA", _ROUNDDELTA_MARKER],
  ["ROUNDEND", _ROUNDEND_MARKER],
  ["STREAMERROR", _STREAMERROR_MARKER],
  ["DONE", _DONE_MARKER],
] as const;
export const _PROTOCOL_MARKER_NAMES = _PROTOCOL_MARKERS.map(([name]) => name);

export type ProtocolMarkerName = typeof _PROTOCOL_MARKERS[number][0];

const UFFFD = String.fromCharCode(0xfffd);
const CONTROL_CHAR_GLOBAL_RE = new RegExp(`[${NUL}${UFFFD}]`, "g");
const CONTROL_CHAR_RE = new RegExp(`[${NUL}${UFFFD}]`);

export function _findNextProtocolMarker(text: string): { name: ProtocolMarkerName; index: number } | null {
  let next: { name: ProtocolMarkerName; index: number } | null = null;
  for (const [name, marker] of _PROTOCOL_MARKERS) {
    const index = text.indexOf(marker);
    if (index !== -1 && (!next || index < next.index)) next = { name, index };
  }
  return next;
}

export function _findCompleteJson(str: string, start: number): { endIndex: number } | null {
  const MAX_DEPTH = 200;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      depth++;
      // 深度上限：畸形/恶意构造的深层未闭合括号不再扫到字符串尾，按未闭合返回 null
      if (depth > MAX_DEPTH) return null;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { endIndex: i + 1 };
      }
    }
  }

  return null;
}

export function _stripProtocolMarkers(text: string): string {
  const normalized = text.replace(CONTROL_CHAR_GLOBAL_RE, "");
  let output = "";
  let index = 0;

  while (index < normalized.length) {
    const marker = _PROTOCOL_MARKER_NAMES.find((name) => normalized.startsWith(name, index));
    if (!marker) {
      output += normalized[index];
      index += 1;
      continue;
    }

    let payloadStart = index + marker.length;
    while (payloadStart < normalized.length && /\s/.test(normalized[payloadStart])) {
      payloadStart += 1;
    }

    if (payloadStart < normalized.length && normalized[payloadStart] === "{") {
      const jsonResult = _findCompleteJson(normalized, payloadStart);
      if (!jsonResult) break;
      index = jsonResult.endIndex;
      continue;
    }

    output += normalized[index];
    index += 1;
  }

  return output;
}

export function _hasUnresolvedProtocolMarker(text: string): boolean {
  const normalized = text.replace(CONTROL_CHAR_GLOBAL_RE, "");
  let searchIndex = 0;
  let hasCompleteMarker = false;

  while (searchIndex < normalized.length) {
    let markerIndex = -1;
    let marker = "";
    for (const name of _PROTOCOL_MARKER_NAMES) {
      const index = normalized.indexOf(name, searchIndex);
      if (index !== -1 && (markerIndex === -1 || index < markerIndex)) {
        markerIndex = index;
        marker = name;
      }
    }
    if (markerIndex === -1) break;

    let payloadStart = markerIndex + marker.length;
    while (payloadStart < normalized.length && /\s/.test(normalized[payloadStart])) {
      payloadStart += 1;
    }
    if (payloadStart >= normalized.length) return true;
    if (normalized[payloadStart] === "{") {
      const jsonResult = _findCompleteJson(normalized, payloadStart);
      if (!jsonResult) return true;
      hasCompleteMarker = true;
      searchIndex = jsonResult.endIndex;
      continue;
    }
    searchIndex = markerIndex + 1;
  }

  return CONTROL_CHAR_RE.test(text) && !hasCompleteMarker;
}
