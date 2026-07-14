import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// Mock api/trash,在用例里改写 mock 实现
const listTrashMock = vi.fn();
const restoreTrashItemMock = vi.fn();
const purgeTrashItemMock = vi.fn();
const emptyTrashMock = vi.fn();
const restoreFileMock = vi.fn();
const consumeRestoreSuccessMock = vi.fn();
let restoreJobsMock: Record<number, unknown> = {};

vi.mock("../../src/features/file-processing/FileProcessingProvider", () => ({
  useFileProcessing: () => ({
    restoreJobs: restoreJobsMock,
    restoreFile: restoreFileMock,
    consumeRestoreSuccess: consumeRestoreSuccessMock,
  }),
}));

vi.mock("../../src/api/trash", () => ({
  listTrash: (...args: unknown[]) => listTrashMock(...args),
  restoreTrashItem: (...args: unknown[]) => restoreTrashItemMock(...args),
  purgeTrashItem: (...args: unknown[]) => purgeTrashItemMock(...args),
  emptyTrash: (...args: unknown[]) => emptyTrashMock(...args),
}));

import { TrashDialog, TRASH_SEARCH_THRESHOLD } from "../../src/components/TrashDialog";

function makeItems(n: number) {
  const items = [];
  for (let i = 1; i <= n; i++) {
    const type = i % 3 === 0 ? "blog_post" : i % 3 === 1 ? "conversation" : "file_document";
    items.push({
      type,
      id: i,
      name: `条目 ${i}`,
      deleted_at: "2026-07-13T00:00:00Z",
    });
  }
  return items;
}

function renderDialog(props?: Partial<React.ComponentProps<typeof TrashDialog>>) {
  return render(
    <TrashDialog
      open
      onOpenChange={() => {}}
      onRestored={vi.fn()}
      onPurged={vi.fn()}
      {...props}
    />,
  );
}

function makeRestoreJob(id: string, status: "running" | "succeeded") {
  return {
    id,
    job_type: "restore",
    status,
    current_stage: status === "succeeded" ? "finalize" : "embedding",
    progress_model_version: "restore_v1",
    progress_percent: status === "succeeded" ? 100 : 60,
    progress_json: { model_version: "restore_v1", current_stage: "embedding", stages: {} },
    client_request_id: null,
    source_document_id: 2,
    result_document_id: null,
    original_name: "条目 2",
    category_id: null,
    error_code: null,
    error_message: null,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:01Z",
    finished_at: status === "succeeded" ? "2026-07-14T00:00:02Z" : null,
  };
}

beforeEach(() => {
  listTrashMock.mockReset();
  restoreTrashItemMock.mockReset();
  purgeTrashItemMock.mockReset();
  emptyTrashMock.mockReset();
  restoreFileMock.mockReset();
  consumeRestoreSuccessMock.mockReset();
  restoreJobsMock = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TrashDialog", () => {
  it("open=true 时调用 listTrash 加载列表", async () => {
    listTrashMock.mockResolvedValueOnce({ items: [], total: 0 });
    renderDialog();
    await waitFor(() => expect(listTrashMock).toHaveBeenCalled());
    expect(await screen.findByText("回收站为空")).toBeInTheDocument();
  });

  it("总数 <= 阈值时不显示搜索框", async () => {
    const items = makeItems(TRASH_SEARCH_THRESHOLD); // 恰好等于阈值,不显示
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    renderDialog();
    await waitFor(() => expect(listTrashMock).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText("按名称搜索")).toBeNull();
  });

  it("总数 > 阈值时显示搜索框并可过滤", async () => {
    const items = makeItems(TRASH_SEARCH_THRESHOLD + 1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    renderDialog();
    await waitFor(() => expect(listTrashMock).toHaveBeenCalled());
    const input = await screen.findByPlaceholderText("按名称搜索");
    expect(input).toBeInTheDocument();
    expect(await screen.findByText("条目 1")).toBeInTheDocument();
    fireEvent.change(input, "条目 5");
    fireEvent.change(input, { target: { value: "条目 5" } });
    await waitFor(() => expect(screen.queryByText("条目 1")).toBeNull());
    expect(screen.getByText("条目 5")).toBeInTheDocument();
  });

  it("点击恢复调用 restoreTrashItem 并从列表移除,触发 onRestored", async () => {
    const items = makeItems(3);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    restoreTrashItemMock.mockResolvedValueOnce(undefined);
    const onRestored = vi.fn();
    renderDialog({ onRestored });
    const restoreButtons = await screen.findAllByRole("button", { name: /恢复/ });
    expect(restoreButtons.length).toBeGreaterThan(0);
    fireEvent.click(restoreButtons[0]);
    await waitFor(() => expect(restoreTrashItemMock).toHaveBeenCalled());
    expect(onRestored).toHaveBeenCalled();
    // 第一个条目被移除(条目 1)
    await waitFor(() => expect(screen.queryByText("条目 1")).toBeNull());
  });

  it("永久删除需要二次确认", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    purgeTrashItemMock.mockResolvedValueOnce(undefined);
    const onPurged = vi.fn();
    renderDialog({ onPurged });
    const purgeBtn = await screen.findByRole("button", { name: /永久删除/ });
    fireEvent.click(purgeBtn);
    // 弹出二次确认
    const confirm = await screen.findByRole("button", { name: "永久删除" });
    expect(purgeTrashItemMock).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(purgeTrashItemMock).toHaveBeenCalled());
    expect(onPurged).toHaveBeenCalled();
  });

  it("清空回收站需要二次确认", async () => {
    const items = makeItems(2);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    emptyTrashMock.mockResolvedValueOnce({
      status: "ok",
      deleted: items.map((it) => ({ type: it.type, id: it.id })),
      failed: [],
      remaining: 0,
    });
    const onPurged = vi.fn();
    renderDialog({ onPurged });
    const emptyBtn = await screen.findByRole("button", { name: /清空回收站/ });
    fireEvent.click(emptyBtn);
    // 弹出二次确认
    const confirm = await screen.findByRole("button", { name: "全部清空" });
    expect(emptyTrashMock).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(emptyTrashMock).toHaveBeenCalled());
    expect(onPurged).toHaveBeenCalledTimes(1);
  });

  it("清空返回 partial 时:移除成功项,保留失败项,显示提示且不关闭", async () => {
    const items = [
      { type: "conversation" as const, id: 1, name: "会话一", deleted_at: "2026-07-13T00:00:00Z" },
      { type: "blog_post" as const, id: 2, name: "文章二", deleted_at: "2026-07-13T00:00:00Z" },
    ];
    listTrashMock.mockResolvedValueOnce({ items, total: 2 });
    emptyTrashMock.mockResolvedValueOnce({
      status: "partial",
      deleted: [{ type: "conversation", id: 1 }],
      failed: [
        {
          item: { type: "blog_post", id: 2 },
          code: "in_use",
          message: "文章正在使用",
        },
      ],
      remaining: 1,
    });
    renderDialog();
    const emptyBtn = await screen.findByRole("button", { name: /清空回收站/ });
    fireEvent.click(emptyBtn);
    const confirm = await screen.findByRole("button", { name: "全部清空" });
    fireEvent.click(confirm);
    await waitFor(() => expect(emptyTrashMock).toHaveBeenCalled());
    // 成功项消失,失败项保留
    await waitFor(() => expect(screen.queryByText("会话一")).toBeNull());
    expect(screen.getByText("文章二")).toBeInTheDocument();
    // partial 提示出现
    expect(screen.getByText(/部分项目无法清空/)).toBeInTheDocument();
  });

  it("恢复按钮被点击时显示 loading 文案(单行 loading)", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    let releaseRestore: () => void = () => {};
    restoreTrashItemMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseRestore = resolve;
      }),
    );
    renderDialog();
    const restoreBtn = await screen.findByRole("button", { name: /恢复/ });
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(restoreTrashItemMock).toHaveBeenCalled());
    // 恢复按钮禁用,永久删除按钮也禁用
    expect(restoreBtn).toBeDisabled();
    releaseRestore();
  });

  it("文件恢复成功按 job ID 显式消费并移除回收站行", async () => {
    const item = makeItems(2)[1];
    listTrashMock.mockResolvedValueOnce({ items: [item], total: 1 });
    restoreJobsMock = { 2: makeRestoreJob("restore-job-1", "succeeded") };
    renderDialog();

    await waitFor(() => expect(consumeRestoreSuccessMock).toHaveBeenCalledWith(2, "restore-job-1"));
    expect(screen.queryByText("条目 2")).toBeNull();
    expect(screen.getByText("共 0 项")).toBeInTheDocument();
    expect(consumeRestoreSuccessMock).toHaveBeenCalledTimes(1);
  });

  it("同一文件后续新恢复 job 成功时仍会再次消费", async () => {
    const item = makeItems(2)[1];
    listTrashMock
      .mockResolvedValueOnce({ items: [item], total: 1 })
      .mockResolvedValueOnce({ items: [item], total: 1 });
    restoreJobsMock = { 2: makeRestoreJob("restore-job-1", "succeeded") };
    const view = renderDialog();

    await waitFor(() => expect(consumeRestoreSuccessMock).toHaveBeenCalledWith(2, "restore-job-1"));
    view.rerender(<TrashDialog open={false} onOpenChange={() => {}} />);
    view.rerender(<TrashDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText("条目 2")).toBeInTheDocument();

    restoreJobsMock = { 2: makeRestoreJob("restore-job-2", "succeeded") };
    view.rerender(<TrashDialog open onOpenChange={() => {}} />);

    await waitFor(() => expect(consumeRestoreSuccessMock).toHaveBeenCalledWith(2, "restore-job-2"));
    expect(consumeRestoreSuccessMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("条目 2")).toBeNull();
  });
});

describe("TrashDialog revision 触发", () => {
  it("恢复成功后调用 onRestored(由父组件 dispatch INCREMENT_TRASH_REVISION)", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    restoreTrashItemMock.mockResolvedValueOnce(undefined);
    const onRestored = vi.fn();
    renderDialog({ onRestored });
    const restoreBtn = await screen.findByRole("button", { name: /恢复/ });
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
  });

  it("永久删除成功后调用 onPurged", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    purgeTrashItemMock.mockResolvedValueOnce(undefined);
    const onPurged = vi.fn();
    renderDialog({ onPurged });
    const purgeBtn = await screen.findByRole("button", { name: /永久删除/ });
    fireEvent.click(purgeBtn);
    const confirm = await screen.findByRole("button", { name: "永久删除" });
    fireEvent.click(confirm);
    await waitFor(() => expect(onPurged).toHaveBeenCalledTimes(1));
  });
});

describe("TrashDialog 行操作显隐与禁用范围", () => {
  it("行操作容器默认 opacity-0,且 className 含 group-hover/group-focus-within", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    renderDialog();
    await screen.findByText("条目 1");
    expect(screen.getByText("已删除的文件、文章和 AI 会话会保留在这里，直到永久删除。")).toBeInTheDocument();
    const restoreBtn = screen.getByRole("button", { name: /恢复/ });
    // 按钮的父容器 div 带 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
    const container = restoreBtn.parentElement;
    expect(container?.className).toContain("opacity-0");
    expect(container?.className).toContain("group-hover:opacity-100");
    expect(container?.className).toContain("group-focus-within:opacity-100");
    // 行 li 带 group
    const row = container?.parentElement;
    expect(row?.className).toContain("group");
  });

  it("恢复单行时只禁用当前行,不污染其他行按钮", async () => {
    const items = makeItems(2);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    let releaseRestore: () => void = () => {};
    restoreTrashItemMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseRestore = resolve;
      }),
    );
    renderDialog();
    const restoreButtons = await screen.findAllByRole("button", { name: /恢复/ });
    expect(restoreButtons.length).toBe(2);
    fireEvent.click(restoreButtons[0]);
    await waitFor(() => expect(restoreTrashItemMock).toHaveBeenCalled());
    const purgeButtons = screen.getAllByRole("button", { name: /永久删除/ });
    // 当前行禁用，另一行仍可操作
    expect(restoreButtons[0]).toBeDisabled();
    expect(purgeButtons[0]).toBeDisabled();
    expect(restoreButtons[1]).toBeEnabled();
    expect(purgeButtons[1]).toBeEnabled();
    releaseRestore();
  });
});

describe("TrashDialog 交互细化", () => {
  it("恢复直接调 API,不弹出二次确认 Dialog", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    restoreTrashItemMock.mockResolvedValueOnce(undefined);
    renderDialog();
    const restoreBtn = await screen.findByRole("button", { name: /恢复/ });
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(restoreTrashItemMock).toHaveBeenCalled());
    // 不应出现「确认」字眼的二级 Dialog 标题
    const confirmTitles = screen.queryAllByText(/确认/);
    expect(confirmTitles.length).toBe(0);
  });

  it("永久删除二次确认中按钮在 loading 时显示「删除中...」", async () => {
    const items = makeItems(1);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    let releasePurge: () => void = () => {};
    purgeTrashItemMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releasePurge = resolve;
      }),
    );
    renderDialog();
    const purgeBtn = await screen.findByRole("button", { name: /永久删除/ });
    fireEvent.click(purgeBtn);
    // 二次确认框出现,点击「永久删除」
    const confirm = await screen.findByRole("button", { name: "永久删除" });
    fireEvent.click(confirm);
    // loading 文案
    await waitFor(() => expect(screen.getByRole("button", { name: "删除中..." })).toBeInTheDocument());
    releasePurge();
  });

  it("清空二次确认 loading 时按钮显示「清空中...」", async () => {
    const items = makeItems(2);
    listTrashMock.mockResolvedValueOnce({ items, total: items.length });
    let releaseEmpty: (result: { status: "ok"; deleted: { type: string; id: number }[]; failed: never[]; remaining: 0 }) => void = () => {};
    emptyTrashMock.mockImplementationOnce(
      () => new Promise<{ status: "ok"; deleted: { type: string; id: number }[]; failed: never[]; remaining: 0 }>((resolve) => {
        releaseEmpty = resolve;
      }),
    );
    renderDialog();
    const emptyBtn = await screen.findByRole("button", { name: /清空回收站/ });
    fireEvent.click(emptyBtn);
    const confirm = await screen.findByRole("button", { name: "全部清空" });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("button", { name: "清空中..." })).toBeDisabled());
    releaseEmpty({ status: "ok", deleted: [], failed: [], remaining: 0 });
  });
});
