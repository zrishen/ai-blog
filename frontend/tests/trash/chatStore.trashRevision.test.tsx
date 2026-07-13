import React from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ChatProvider, useChat } from "../../src/stores/chatStore";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ChatProvider>{children}</ChatProvider>;
}

beforeEach(() => {
  localStorage.clear();
});

describe("chatStore trashRevision", () => {
  it("初始值为 0", () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    expect(result.current.state.trashRevision).toBe(0);
  });

  it("INCREMENT_TRASH_REVISION 每次 +1", () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    act(() => result.current.dispatch({ type: "INCREMENT_TRASH_REVISION" }));
    expect(result.current.state.trashRevision).toBe(1);
    act(() => result.current.dispatch({ type: "INCREMENT_TRASH_REVISION" }));
    expect(result.current.state.trashRevision).toBe(2);
  });

  it("LOGOUT 也递增 trashRevision(恢复登录后清理本地缓存的语义)", () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    act(() => result.current.dispatch({ type: "LOGOUT" }));
    expect(result.current.state.trashRevision).toBe(1);
  });
});
