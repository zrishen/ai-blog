import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSkills, getSkillSettings, updateSkillSettings } from "../../src/api/skills";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("skill API 函数", () => {
  it("getSkills 解包 {skills: [...]} 返回数组", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ skills: [{ id: "writing", name: "写作", description: "d" }] }), {
        status: 200,
      }),
    );
    const skills = await getSkills();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/skills");
    expect(skills).toEqual([{ id: "writing", name: "写作", description: "d" }]);
  });

  it("getSkillSettings 返回 {enabled_skills: [...]}", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled_skills: ["writing", "memory"] }), { status: 200 }),
    );
    const settings = await getSkillSettings();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/settings/skills");
    expect(settings.enabled_skills).toEqual(["writing", "memory"]);
  });

  it("updateSkillSettings([]) 发 PUT 且空数组保留（显式全关）", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled_skills: [] }), { status: 200 }),
    );
    const res = await updateSkillSettings([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/settings/skills",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ enabled_skills: [] }),
      }),
    );
    expect(res.enabled_skills).toEqual([]);
  });
});
