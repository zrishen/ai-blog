import { useEffect, useState } from "react";

import { useChat } from "@/stores/chatStore";
import { getSkills, getSkillSettings, updateSkillSettings } from "@/api/skills";
import { errorMessage } from "@/lib/errors";

import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import type { SkillId, SkillSummary } from "@/types/skill";

export function SkillSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useChat();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时拉取 skill 目录 + 当前用户设置。setState 全在 Promise 链中（effect body 无同步 setState，
  // 避免 react-hooks/set-state-in-effect）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([getSkills(), getSkillSettings()])
      .then(([catalog, settings]) => {
        if (cancelled) return;
        setSkills(catalog);
        dispatch({ type: "SET_ENABLED_SKILLS", payload: settings.enabled_skills });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, "读取 skill 列表失败"));
        setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dispatch]);

  const toggleSkill = async (skillId: SkillId) => {
    // checked 从 store 只读派生，避免 onClick 推导的竞态
    const current = state.enabledSkills ?? [];
    const checked = current.includes(skillId);
    const previous = current;
    const next = checked
      ? current.filter((id) => id !== skillId)
      : [...current, skillId];

    dispatch({ type: "SET_ENABLED_SKILLS", payload: next });
    setIsSaving(true);
    setError(null);
    try {
      const res = await updateSkillSettings(next);
      dispatch({ type: "SET_ENABLED_SKILLS", payload: res.enabled_skills });
    } catch (err) {
      dispatch({ type: "SET_ENABLED_SKILLS", payload: previous }); // 回滚
      setError(errorMessage(err, "保存失败，已还原"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-body-lg">skill</DialogTitle>
          <DialogDescription className="text-meta">
            选择本次对话启用的能力。未启用时不会挂载对应工具与指令。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {error && (
            <Alert variant="destructive" className="text-meta">
              {error}
            </Alert>
          )}
          {skills === null ? (
            <p className="text-meta text-muted-foreground">加载中…</p>
          ) : (
            skills.map((skill) => {
              const checked = state.enabledSkills?.includes(skill.id) ?? false;
              return (
                <div
                  key={skill.id}
                  className="flex items-start justify-between gap-3 rounded-panel border border-border/70 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-body font-medium text-foreground">{skill.name}</div>
                    <div className="mt-0.5 text-meta text-muted-foreground">{skill.description}</div>
                  </div>
                  <Switch
                    checked={checked}
                    onClick={() => toggleSkill(skill.id)}
                    disabled={isSaving}
                    aria-label={`切换 ${skill.name}`}
                  />
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
