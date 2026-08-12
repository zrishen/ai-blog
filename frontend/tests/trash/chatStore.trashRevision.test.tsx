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

describe("chatStore file/trash revisions", () => {
  it("保存选中文件，供工作区切换到文件预览", () => {
    const { result } = renderHook(() => useChat(), { wrapper });

    act(() => result.current.dispatch({ type: "SET_FILE_SELECTED_FILE", payload: "report.pdf" }));
    expect(result.current.state.fileSelectedFile).toBe("report.pdf");

    act(() => result.current.dispatch({ type: "SET_FILE_SELECTED_FILE", payload: null }));
    expect(result.current.state.fileSelectedFile).toBeNull();
  });

  it("初始值为 0", () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    expect(result.current.state.fileLibraryRevision).toBe(0);
    expect(result.current.state.trashRevision).toBe(0);
  });

  it("上传成功只递增 fileLibraryRevision 一次", () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    act(() => result.current.dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" }));
    expect(result.current.state.fileLibraryRevision).toBe(1);
    expect(result.current.state.trashRevision).toBe(0);
  });

  it("文件恢复成功同时各递增一次", () => {
    const { result } = renderHook(() => useChat(), { wrapper });
    act(() => result.current.dispatch({ type: "INCREMENT_FILE_RESTORE_REVISIONS" }));
    expect(result.current.state.fileLibraryRevision).toBe(1);
    expect(result.current.state.trashRevision).toBe(1);
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
