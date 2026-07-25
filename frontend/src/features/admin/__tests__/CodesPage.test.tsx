import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CodesPage } from "../components/CodesPage";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const SAMPLE_CODE = {
  id: 1,
  code: "ABC-123-ZZZ",
  duration_days: 30,
  is_used: false,
  used_by_user_id: null,
  created_at: "2026-01-01T00:00:00Z",
  note: "活动赠送",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("CodesPage", () => {
  it("smoke: 渲染标题并展示列表关键数据", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [SAMPLE_CODE], offset: 0, limit: 20 }),
    );

    render(<CodesPage />);

    expect(await screen.findByText("兑换码管理")).toBeInTheDocument();
    expect(await screen.findByText("ABC-123-ZZZ")).toBeInTheDocument();
    expect(await screen.findByText("30天")).toBeInTheDocument();
    expect(await screen.findByText("未用")).toBeInTheDocument();
    expect(screen.getByText("活动赠送")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /作废/ }),
    ).toBeInTheDocument();
  });

  it("请求失败时展示错误文案", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "服务器异常" }, false, 500),
    );

    render(<CodesPage />);

    expect(await screen.findByText("服务器异常")).toBeInTheDocument();
  });

  it("空列表展示占位文案", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], offset: 0, limit: 20 }),
    );

    render(<CodesPage />);

    expect(await screen.findByText("暂无兑换码")).toBeInTheDocument();
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("生成兑换码：提交后弹出明文结果与保存提示", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        return jsonResponse({ codes: ["NEW-1", "NEW-2"] });
      }
      return jsonResponse({ items: [], offset: 0, limit: 20 });
    });

    render(<CodesPage />);

    // 打开生成对话框（此时 DOM 中只有顶部按钮匹配该文案）
    fireEvent.click(await screen.findByText("生成兑换码"));

    // 默认 count=1/days=30，直接确认
    fireEvent.click(await screen.findByText("确认生成"));

    await waitFor(() => {
      expect(screen.getByText("NEW-1")).toBeInTheDocument();
      expect(screen.getByText("NEW-2")).toBeInTheDocument();
    });
    expect(
      screen.getByText("请立即保存，关闭后无法再查看明文"),
    ).toBeInTheDocument();
    expect(screen.getByText("全部复制")).toBeInTheDocument();
  });

  it("点击作废弹出二次确认对话框", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [SAMPLE_CODE], offset: 0, limit: 20 }),
    );

    render(<CodesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /作废/ }));

    expect(await screen.findByText("确认作废")).toBeInTheDocument();
    // 表格行 + 作废对话框都展示了该兑换码
    expect(screen.getAllByText("ABC-123-ZZZ").length).toBeGreaterThanOrEqual(2);
  });
});
