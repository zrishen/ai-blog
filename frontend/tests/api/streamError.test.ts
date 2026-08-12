import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _PROTOCOL_MARKERS } from "../../src/api/chatProtocol";

function marker(name: string): string {
  const found = _PROTOCOL_MARKERS.find(([n]) => n === name);
  if (!found) throw new Error(`unknown marker: ${name}`);
  return found[1];
}

const DEFAULT_ERR = "无法获取回复，请稍后重试";

describe("_extractStreamError", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("完整 STREAMERROR 帧返回 message", async () => {
    const { _extractStreamError } = await import("../../src/api/chat");
    const buf = `前文${marker("STREAMERROR")}${JSON.stringify({ message: "模型超时" })}后文`;
    expect(_extractStreamError(buf)).toBe("模型超时");
  });

  it("帧未完整（marker 后 JSON 截断）返回 null", async () => {
    const { _extractStreamError } = await import("../../src/api/chat");
    const truncated = JSON.stringify({ message: "x" }).slice(0, 5);
    expect(_extractStreamError(`${marker("STREAMERROR")}${truncated}`)).toBeNull();
  });

  it("payload 无 message 字段返回默认错误文案", async () => {
    const { _extractStreamError } = await import("../../src/api/chat");
    const buf = `${marker("STREAMERROR")}${JSON.stringify({ code: 500 })}`;
    expect(_extractStreamError(buf)).toBe(DEFAULT_ERR);
  });

  it("payload 非法 JSON 返回默认错误文案", async () => {
    const { _extractStreamError } = await import("../../src/api/chat");
    // 构造可被 _findCompleteJson 识别为完整对象但 JSON.parse 失败的串
    const buf = `${marker("STREAMERROR")}{not valid}`;
    expect(_extractStreamError(buf)).toBe(DEFAULT_ERR);
  });

  it("不含 marker 返回 null", async () => {
    const { _extractStreamError } = await import("../../src/api/chat");
    expect(_extractStreamError("纯文本流无错误帧")).toBeNull();
  });

  it("message 非 string 类型返回默认错误文案", async () => {
    const { _extractStreamError } = await import("../../src/api/chat");
    const buf = `${marker("STREAMERROR")}${JSON.stringify({ message: 42 })}`;
    expect(_extractStreamError(buf)).toBe(DEFAULT_ERR);
  });
});
