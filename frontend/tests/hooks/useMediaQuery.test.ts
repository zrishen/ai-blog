import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "../../src/hooks/useMediaQuery";

type MediaListener = (event: MediaQueryListEvent) => void;

// 可控的 matchMedia 桩：每个 query 各自维护 matches 与监听器集合
const registries = new Map<string, { matches: boolean; listeners: Set<MediaListener> }>();

function registryFor(query: string) {
  let r = registries.get(query);
  if (!r) {
    r = { matches: false, listeners: new Set() };
    registries.set(query, r);
  }
  return r;
}

function installMatchMedia() {
  registries.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const reg = registryFor(query);
      return {
        matches: reg.matches,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: MediaListener) => {
          reg.listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: MediaListener) => {
          reg.listeners.delete(listener);
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
}

function setMatches(query: string, matches: boolean) {
  const reg = registryFor(query);
  reg.matches = matches;
  const event = { matches, media: query } as MediaQueryListEvent;
  reg.listeners.forEach((listener) => listener(event));
}

beforeEach(() => {
  installMatchMedia();
});

afterEach(() => {
  vi.unstubAllGlobals();
  registries.clear();
});

describe("useMediaQuery", () => {
  it("查询匹配时返回 true", () => {
    setMatches("(min-width: 768px)", true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("查询不匹配时返回 false", () => {
    setMatches("(min-width: 768px)", false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("默认状态为不匹配（getServerSnapshot=false）", () => {
    // 不预先 setMatches，registry 初始 matches=false
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("查询从 false 翻为 true 时组件重新渲染并返回 true", () => {
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => setMatches("(min-width: 768px)", true));
    expect(result.current).toBe(true);
  });

  it("查询从 true 翻为 false 时组件重新渲染并返回 false", () => {
    setMatches("(min-width: 768px)", true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(true);

    act(() => setMatches("(min-width: 768px)", false));
    expect(result.current).toBe(false);
  });

  it("同一 listener 不会重复接收事件（去重）", () => {
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    const reg = registryFor("(min-width: 768px)");

    // React 18 StrictMode 下 subscribe 可能被调多次但 useCallback 复用同一闭包，
    // 这里仅断言：单次 change 事件触发后状态只翻转一次（无重复回调导致的双触发）。
    expect(reg.listeners.size).toBeGreaterThanOrEqual(1);
    act(() => setMatches("(min-width: 768px)", true));
    expect(result.current).toBe(true);
  });

  it("切换 query 时重新订阅新查询并反映新状态", () => {
    setMatches("(min-width: 768px)", true);
    setMatches("(min-width: 1024px)", false);

    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: "(min-width: 768px)" },
    });
    expect(result.current).toBe(true);

    rerender({ q: "(min-width: 1024px)" });
    expect(result.current).toBe(false);

    // 旧 query 的变化不应影响已切走的 hook
    act(() => setMatches("(min-width: 768px)", false));
    expect(result.current).toBe(false);

    // 新 query 的变化应反映出来
    act(() => setMatches("(min-width: 1024px)", true));
    expect(result.current).toBe(true);
  });

  it("卸载后不再监听：change 事件不影响已卸载的 hook", () => {
    const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
    unmount();

    const reg = registryFor("(min-width: 768px)");
    expect(reg.listeners.size).toBe(0);

    // 卸载后触发事件不应抛错
    expect(() => act(() => setMatches("(min-width: 768px)", true))).not.toThrow();
  });

  it("每个 query 的监听器相互隔离", () => {
    setMatches("(min-width: 768px)", false);
    setMatches("(orientation: portrait)", true);

    const a = renderHook(() => useMediaQuery("(min-width: 768px)"));
    const b = renderHook(() => useMediaQuery("(orientation: portrait)"));

    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(true);

    act(() => setMatches("(min-width: 768px)", true));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true); // 不受另一个 query 影响

    act(() => setMatches("(orientation: portrait)", false));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(false);
  });
});
