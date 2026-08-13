import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatProvider } from "../../src/stores/chatStore";
import { SkillSettingsDialog } from "../../src/features/ai-chat/ai-sidebar/SkillSettingsDialog";

const skillsApi = vi.hoisted(() => ({
  getSkills: vi.fn(),
  getSkillSettings: vi.fn(),
  updateSkillSettings: vi.fn(),
}));

vi.mock("../../src/api/skills", () => skillsApi);

const CATALOG = [
  { id: "writing", name: "写作", description: "博客文章创作" },
  { id: "knowledge", name: "知识库", description: "检索知识库文档" },
  { id: "memory", name: "记忆", description: "回忆过往对话" },
];

function renderDialog() {
  return render(
    <ChatProvider>
      <SkillSettingsDialog open onOpenChange={() => {}} />
    </ChatProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  skillsApi.getSkills.mockResolvedValue(CATALOG);
  skillsApi.getSkillSettings.mockResolvedValue({ enabled_skills: ["writing", "memory"] });
  skillsApi.updateSkillSettings.mockImplementation(async (ids: string[]) => ({
    enabled_skills: ids,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SkillSettingsDialog", () => {
  it("打开时双读 catalog + 设置，渲染全部 skill", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("写作")).toBeInTheDocument();
      expect(screen.getByText("知识库")).toBeInTheDocument();
      expect(screen.getByText("记忆")).toBeInTheDocument();
    });
    expect(skillsApi.getSkills).toHaveBeenCalledOnce();
    expect(skillsApi.getSkillSettings).toHaveBeenCalledOnce();
  });

  it("设置中的 skill 开关为开启态", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("写作")).toBeInTheDocument());
    // 设置只有 writing+memory → knowledge 关闭
    expect(screen.getByRole("switch", { name: "切换 写作" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "切换 知识库" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "切换 记忆" })).toHaveAttribute("aria-checked", "true");
  });

  it("切换开关：乐观更新 + PUT 持久化（写入目标态）", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(screen.getByText("知识库")).toBeInTheDocument());
    await user.click(screen.getByRole("switch", { name: "切换 知识库" }));
    await waitFor(() => expect(skillsApi.updateSkillSettings).toHaveBeenCalledOnce());
    expect(skillsApi.updateSkillSettings.mock.calls[0][0]).toEqual(["writing", "memory", "knowledge"]);
  });

  it("PUT 失败时回滚开关并提示", async () => {
    const user = userEvent.setup();
    // reject 非 Error 值，使 errorMessage 使用 fallback「保存失败，已还原」
    skillsApi.updateSkillSettings.mockRejectedValueOnce("network error");
    renderDialog();
    await waitFor(() => expect(screen.getByText("知识库")).toBeInTheDocument());
    await user.click(screen.getByRole("switch", { name: "切换 知识库" }));
    await waitFor(() => expect(screen.getByText("保存失败，已还原")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: "切换 知识库" })).toHaveAttribute("aria-checked", "false");
  });
});
