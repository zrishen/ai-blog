import { describe, expect, it, vi } from "vitest";
import { createPatchDeltaPlayer } from "../../src/features/ai-chat/ai-sidebar/patchDeltaPlayer";

function createFrameHarness() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    schedule(callback: FrameRequestCallback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: number) {
      callbacks.delete(handle);
    },
    runFrame() {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return false;
      callbacks.delete(entry[0]);
      entry[1](performance.now());
      return true;
    },
    pending() {
      return callbacks.size;
    },
  };
}

describe("patchDeltaPlayer", () => {
  it("入场门控打开前缓存增量，打开后跨帧渐进输出", () => {
    const frames = createFrameHarness();
    const chunks: string[] = [];
    const player = createPatchDeltaPlayer(
      (delta) => chunks.push(delta),
      frames.schedule,
      frames.cancel,
    );

    player.push("这是逐字出现的新文本");
    expect(chunks).toEqual([]);
    expect(frames.pending()).toBe(0);

    player.open();
    expect(frames.pending()).toBe(1);
    frames.runFrame();
    expect(chunks.join("").length).toBeGreaterThan(0);
    expect(chunks.join("").length).toBeLessThan("这是逐字出现的新文本".length);

    while (frames.runFrame()) { /* drain scheduled frames */ }
    expect(chunks.join("")).toBe("这是逐字出现的新文本");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("工具结束会等待缓存播放完再完成", async () => {
    const frames = createFrameHarness();
    const chunks: string[] = [];
    const player = createPatchDeltaPlayer(
      (delta) => chunks.push(delta),
      frames.schedule,
      frames.cancel,
    );

    player.push("快速工具也要播完补丁");
    player.open();
    const finished = vi.fn();
    const finishPromise = player.finish().then(finished);

    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    frames.runFrame();
    expect(finished).not.toHaveBeenCalled();
    while (chunks.join("") !== "快速工具也要播完补丁") frames.runFrame();
    expect(finished).not.toHaveBeenCalled();
    frames.runFrame();
    await finishPromise;

    expect(chunks.join("")).toBe("快速工具也要播完补丁");
    expect(finished).toHaveBeenCalledOnce();
  });

  it("播放期间收到的新增量继续进入后续帧", () => {
    const frames = createFrameHarness();
    const chunks: string[] = [];
    const player = createPatchDeltaPlayer(
      (delta) => chunks.push(delta),
      frames.schedule,
      frames.cancel,
    );

    player.open();
    player.push("第一段内容");
    frames.runFrame();
    player.push("第二段内容");
    while (frames.runFrame()) { /* drain scheduled frames */ }

    expect(chunks.join("")).toBe("第一段内容第二段内容");
    expect(chunks.length).toBeGreaterThan(1);
  });
});
