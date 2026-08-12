import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatInputBar } from "../../src/features/ai-chat/ai-sidebar/ChatInputBar";

import type { DraftAttachment } from "../../src/features/ai-chat/types";

function renderInput(overrides: Partial<React.ComponentProps<typeof ChatInputBar>> = {}) {
  const props: React.ComponentProps<typeof ChatInputBar> = {
    streaming: false,
    input: "",
    textareaRef: { current: null },
    attachments: [],
    attachmentsEnabled: true,
    sendDisabled: true,
    getAttachmentPreviewUrl: () => undefined,
    onSelectAttachments: vi.fn(),
    onRetryAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onInputChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onPickFiles: vi.fn(),
    onOpenPlugins: vi.fn(),
    ...overrides,
  };
  render(<ChatInputBar {...props} />);
  return props;
}

function draft(status: DraftAttachment["status"]): DraftAttachment {
  return {
    localId: "draft-1",
    file: new File(["hello"], "说明.txt", { type: "text/plain" }),
    status,
    progress: status === "uploaded" ? 100 : 42,
    position: 0,
    ...(status === "failed" ? { error: "上传失败" } : {}),
  };
}

describe("ChatInputBar attachments", () => {
  it("通过 multiple file input 选择多个附件", async () => {
    const user = userEvent.setup();
    const props = renderInput();
    await user.click(screen.getByRole("button", { name: "添加内容" }));
    const uploadItem = screen.getByText("上传文件");
    expect(uploadItem).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>("#ai-sidebar-attachment-input")!;
    const clickSpy = vi.spyOn(input, "click");
    await user.click(uploadItem);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(input.multiple).toBe(true);
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.pdf")];
    fireEvent.change(input, { target: { files } });
    expect(props.onSelectAttachments).toHaveBeenCalledOnce();
    expect(Array.from(props.onSelectAttachments.mock.calls[0][0] as FileList)).toHaveLength(2);
  });

  it("粘贴文件立即交给上传回调", () => {
    const props = renderInput();
    const file = new File(["image"], "paste.png", { type: "image/png" });
    fireEvent.paste(screen.getByPlaceholderText("想写什么，尽管说"), {
      clipboardData: { files: [file] },
    });
    expect(props.onSelectAttachments).toHaveBeenCalledWith([file]);
  });

  it.each(["uploading", "failed"] as const)("%s 附件时禁用发送", (status) => {
    renderInput({ attachments: [draft(status)], sendDisabled: true });
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });

  it("已上传纯附件时允许发送", () => {
    renderInput({ attachments: [draft("uploaded")], sendDisabled: false });
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
  });

  it("附件托盘独立显示在文本输入框上方", () => {
    renderInput({ attachments: [draft("uploaded")], sendDisabled: false });
    const tray = screen.getByTestId("attachment-draft-tray");
    const composer = screen.getByTestId("ai-chat-composer");
    expect(tray.parentElement).toBe(composer.parentElement);
    expect(tray.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(composer).not.toContainElement(tray);
  });

  it("附件进入发送状态后从输入区隐藏", () => {
    renderInput({ attachments: [draft("sending")], sendDisabled: true });
    expect(screen.queryByText("正在发送")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("待发送附件")).not.toBeInTheDocument();
  });
});
