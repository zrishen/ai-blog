import { API_BASE, apiFetch, assertOk, parseJson } from "./client";

import type { SkillId, SkillSettings, SkillSettingsUpdate, SkillSummary } from "@/types/skill";

/** GET /skills — 后端 SKILL_REGISTRY 投影，前端不硬编码 skill 列表。 */
export async function getSkills(): Promise<SkillSummary[]> {
  const res = await apiFetch(`${API_BASE}/skills`);
  await assertOk(res, "Failed to fetch skills");
  const data = await parseJson<{ skills: SkillSummary[] }>(res);
  return data.skills;
}

/** GET /settings/skills — 当前用户的有效 skill 选择（无记录 = 后端默认全开）。 */
export async function getSkillSettings(): Promise<SkillSettings> {
  const res = await apiFetch(`${API_BASE}/settings/skills`);
  await assertOk(res, "Failed to fetch skill settings");
  return parseJson<SkillSettings>(res);
}

/** PUT /settings/skills — 持久化显式选择（空数组 = 显式全关）。 */
export async function updateSkillSettings(
  enabledSkills: SkillId[],
): Promise<SkillSettings> {
  const res = await apiFetch(`${API_BASE}/settings/skills`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled_skills: enabledSkills } satisfies SkillSettingsUpdate),
  });
  await assertOk(res, "Failed to update skill settings");
  return parseJson<SkillSettings>(res);
}
