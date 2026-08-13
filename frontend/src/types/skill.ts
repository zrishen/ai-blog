/** Skill 目录与用户 skill 设置的前端类型（后端为唯一事实源）。 */

export type SkillId = string;

export interface SkillSummary {
  id: SkillId;
  name: string;
  description: string;
}

export interface SkillSettings {
  enabled_skills: SkillId[];
}

export interface SkillSettingsUpdate {
  enabled_skills: SkillId[];
}
