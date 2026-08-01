import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "../../src/features/ai-chat/ai-sidebar/MessageList";
import type { Message } from "../../src/stores/chatStore";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

type StreamingMessage = Message & {
  streamingRound?: string;
  streamFinalized?: boolean;
  streamError?: string;
};

function assistantMessage(overrides: Partial<StreamingMessage> = {}): StreamingMessage {
  return {
    id: -1,
    conversation_id: 7,
    role: "assistant",
    content: "",
    token_count: 0,
    created_at: "2026-07-10T10:00:00.000Z",
    ...overrides,
  };
}

function renderMessage(message: StreamingMessage, streaming: boolean) {
  return render(
    <MessageList
      groups={[{ role: "assistant", messages: [message] }]}
      streaming={streaming}
      msgsEndRef={{ current: null }}
      historyLoading={false}
      historyLoadError={null}
      emptyHint=""
      onReloadHistory={vi.fn()}
      onTrustChoiceSelect={vi.fn()}
    />,
  );
}

describe("MessageList 思考过程生命周期", () => {
  it("把 streamingRound 作为过程流末尾临时节点，并在提交后避免重复", () => {
    const message = assistantMessage({
      loopSteps: ["分析已有资料"],
      streamingRound: "调用检索工具",
    });
    const { rerender } = renderMessage(message, true);

    const process = screen.getByTestId("thinking-process");
    expect(process).toHaveTextContent("分析已有资料");
    expect(process).toHaveTextContent("调用检索工具");
    expect(process.textContent?.indexOf("分析已有资料")).toBeLessThan(
      process.textContent?.indexOf("调用检索工具") ?? 0,
    );

    rerender(
      <MessageList
        groups={[{
          role: "assistant",
          messages: [{ ...message, loopSteps: ["分析已有资料", "调用检索工具"] }],
        }]}
        streaming
        msgsEndRef={{ current: null }}
        historyLoading={false}
        historyLoadError={null}
        emptyHint=""
        onReloadHistory={vi.fn()}
        onTrustChoiceSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText("调用检索工具")).toHaveLength(1);
  });

  it("流式中 reasoning 到达时,模型推理折叠块默认收起但标题可见", () => {
    const message = assistantMessage({
      reasoningContent: "用户在问天气,需要调用工具查询",
    });
    renderMessage(message, true);

    const panel = screen.getByTestId("thinking-panel");
    expect(panel).toHaveAttribute("data-streaming", "true");

    const trigger = screen.getByText(/模型推理/);
    expect(trigger).toBeInTheDocument();

    expect(screen.queryByText("用户在问天气,需要调用工具查询")).not.toBeInTheDocument();
  });

  it("流式时无折叠容器，final 后切换为带 trigger 的折叠容器并默认收起", async () => {
    const message = assistantMessage({
      loopSteps: ["整理答案结构"],
      streamingRound: "生成最终回答",
    });
    const { rerender } = renderMessage(message, true);

    const streamingPanel = screen.getByTestId("thinking-panel");
    expect(streamingPanel).toHaveAttribute("data-streaming", "true");
    expect(streamingPanel.tagName).toBe("DIV");
    expect(screen.queryByRole("button", { name: /思考过程/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("thinking-process")).toHaveTextContent("生成最终回答");

    rerender(
      <MessageList
        groups={[{
          role: "assistant",
          messages: [{
            ...message,
            id: 42,
            content: "这是最终回答",
            streamFinalized: true,
            streamingRound: undefined,
            loopSteps: ["整理答案结构", "生成最终回答"],
            thinkingDurationMs: 1800,
          }],
        }]}
        streaming={false}
        msgsEndRef={{ current: null }}
        historyLoading={false}
        historyLoadError={null}
        emptyHint=""
        onReloadHistory={vi.fn()}
        onTrustChoiceSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("这是最终回答")).toBeInTheDocument();
    const finalizedPanel = screen.getByTestId("thinking-panel");
    expect(finalizedPanel).toHaveAttribute("data-streaming", "false");
    const trigger = screen.getByRole("button", { name: /思考过程/ });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    const process = screen.getByTestId("thinking-process");
    await waitFor(() => expect(process).toHaveClass("grid-rows-[0fr]", "opacity-0", "mt-0"));
    expect(process).toHaveAttribute("aria-hidden", "true");
  });

  it("自动折叠只执行一次，用户展开后 ID 再迁移也保持展开", async () => {
    const user = userEvent.setup();
    const message = assistantMessage({ loopSteps: ["验证结果"] });
    const { rerender } = renderMessage(message, true);

    rerender(
      <MessageList
        groups={[{ role: "assistant", messages: [{ ...message, id: 10, streamFinalized: true }] }]}
        streaming={false}
        msgsEndRef={{ current: null }}
        historyLoading={false}
        historyLoadError={null}
        emptyHint=""
        onReloadHistory={vi.fn()}
        onTrustChoiceSelect={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /思考过程/ });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    rerender(
      <MessageList
        groups={[{ role: "assistant", messages: [{ ...message, id: 11, streamFinalized: true }] }]}
        streaming={false}
        msgsEndRef={{ current: null }}
        historyLoading={false}
        historyLoadError={null}
        emptyHint=""
        onReloadHistory={vi.fn()}
        onTrustChoiceSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /思考过程/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("普通回答完成后不保留空面板，并继续展示旧 thinkingContent", () => {
    const { rerender } = renderMessage(assistantMessage({ id: 8, content: "普通回答" }), false);
    expect(screen.queryByTestId("thinking-panel")).not.toBeInTheDocument();

    rerender(
      <MessageList
        groups={[{
          role: "assistant",
          messages: [assistantMessage({ id: 9, content: "历史回答", thinkingContent: "旧版思考过程内容" })],
        }]}
        streaming={false}
        msgsEndRef={{ current: null }}
        historyLoading={false}
        historyLoadError={null}
        emptyHint=""
        onReloadHistory={vi.fn()}
        onTrustChoiceSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("thinking-panel")).toBeInTheDocument();
    expect(screen.getByText("旧版思考过程内容")).toBeInTheDocument();
  });
});

describe("MessageList 等待首字节占位", () => {
  it("流式中且无任何可见内容时显示「正在思考」占位", () => {
    const message = assistantMessage();
    renderMessage(message, true);

    const placeholder = screen.getByTestId("thinking-placeholder");
    expect(placeholder).toHaveTextContent("正在思考...");
    expect(placeholder.querySelector(".thinking-flow-text")).not.toBeNull();
  });

  it("首个 streamingRound 到达后立即隐藏占位", () => {
    const message = assistantMessage({ streamingRound: "调" });
    renderMessage(message, true);

    expect(screen.queryByTestId("thinking-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("thinking-process")).toHaveTextContent("调");
  });

  it("reasoningContent 到达后也隐藏占位", () => {
    const message = assistantMessage({ reasoningContent: "需要调用工具" });
    renderMessage(message, true);

    expect(screen.queryByTestId("thinking-placeholder")).not.toBeInTheDocument();
  });

  it("非流式历史消息不显示占位", () => {
    const message = assistantMessage({ id: 42, content: "历史回答" });
    renderMessage(message, false);

    expect(screen.queryByTestId("thinking-placeholder")).not.toBeInTheDocument();
  });

  it("streamError 到达时错误提示在折叠外显示，且不渲染思考面板", () => {
    const message = assistantMessage({ streamError: "请先在「设置」页填写你自己的 API 密钥，或订阅后使用。" });
    renderMessage(message, true);

    expect(screen.queryByTestId("thinking-placeholder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thinking-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("stream-error-banner")).toHaveTextContent("请先在「设置」页填写你自己的 API 密钥，或订阅后使用。");
  });

  it("错误结束（已记录耗时）时不显示思考折叠，错误在折叠外", () => {
    const message = assistantMessage({
      streamError: "无法获取回复，请稍后重试",
      thinkingDurationMs: 1500,
      streamFinalized: true,
    });
    renderMessage(message, false);

    expect(screen.queryByTestId("thinking-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("stream-error-banner")).toHaveTextContent("无法获取回复，请稍后重试");
  });
});

describe("MessageList 流式过程表格掩码", () => {
  it("未闭合的表格头不暴露 Markdown 源码（| 字符不出现）", () => {
    const message = assistantMessage({
      streamingRound: "我先列一下数据：\n\n| 名字 | 分数 |",
    });
    renderMessage(message, true);

    const process = screen.getByTestId("thinking-process");
    expect(process).toHaveTextContent("我先列一下数据：");
    // 表头源码（| 名字 | 分数 |）应该被剥掉，不在 DOM 中暴露
    expect(process.textContent).not.toMatch(/\|\s*名字\s*\|/);
    expect(process.textContent).not.toMatch(/\|\s*分数\s*\|/);
  });

  it("完整表格（含 separator + 数据行）在过程节点渲染成 <table>", () => {
    const message = assistantMessage({
      streamingRound: ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"),
    });
    renderMessage(message, true);

    const process = screen.getByTestId("thinking-process");
    const table = process.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("th")).toHaveLength(2);
    expect(table?.querySelectorAll("td")).toHaveLength(2);
    expect(table).toHaveTextContent("1");
    expect(table).toHaveTextContent("2");
  });
});
