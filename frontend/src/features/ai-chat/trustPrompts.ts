export type TrustChoiceAction =
  | "start_research"
  | "continue_research"
  | "open_research_graph"
  | "open_conflicts"
  | "explain_conflicts"
  | "write_from_confirmed_facts"
  | "select_topic"
  | "create_topic"
  | "dismiss";

export type TrustChoiceOption =
  | {
      id: string;
      label: string;
      kind: "action";
      action: TrustChoiceAction;
    }
  | {
      id: string;
      label: string;
      kind: "reply";
      prompt: string;
    };

export interface TrustChoicePayload {
  message: string;
  choices: TrustChoiceOption[];
}

const TRUST_CHOICE_ACTIONS = new Set<TrustChoiceAction>([
  "start_research",
  "continue_research",
  "open_research_graph",
  "open_conflicts",
  "explain_conflicts",
  "write_from_confirmed_facts",
  "select_topic",
  "create_topic",
  "dismiss",
]);

const MAX_AI_CHOICES = 4;
const MAX_REPLY_PROMPT_LENGTH = 500;

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function findJsonPayload(content: string): unknown | null {
  const candidates = [content.trim()];
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) candidates.unshift(fenceMatch[1].trim());

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(content.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && "choices" in parsed) return parsed;
    } catch {}
  }

  return null;
}

export function sanitizeTrustChoices(rawChoices: unknown, appendDismiss = true): TrustChoiceOption[] {
  if (!Array.isArray(rawChoices)) {
    return appendDismiss ? [{ id: "trust-choice-dismiss", label: "不选择", kind: "action", action: "dismiss" }] : [];
  }

  const choices: TrustChoiceOption[] = [];

  for (const raw of rawChoices) {
    if (!raw || typeof raw !== "object" || choices.length >= MAX_AI_CHOICES) continue;
    const item = raw as Record<string, unknown>;
    const label = readString(item.label);
    const kind = item.kind;
    if (!label) continue;

    if (kind === "action") {
      const action = readString(item.action) as TrustChoiceAction;
      if (!TRUST_CHOICE_ACTIONS.has(action) || action === "dismiss") continue;
      const originalId = typeof item.id === "string" && item.id ? item.id : `trust-choice-action-${action}-${choices.length}`;
      choices.push({ id: originalId, label, kind: "action", action });
      continue;
    }

    if (kind === "reply") {
      const prompt = readString(item.prompt);
      if (!prompt || prompt.length > MAX_REPLY_PROMPT_LENGTH) continue;
      choices.push({ id: `trust-choice-reply-${choices.length}`, label, kind: "reply", prompt });
    }
  }

  if (appendDismiss) {
    choices.push({ id: "trust-choice-dismiss", label: "不选择", kind: "action", action: "dismiss" });
  }

  return choices;
}

export function parseTrustChoicePayload(content: string): TrustChoicePayload | null {
  const parsed = findJsonPayload(content);
  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Record<string, unknown>;
  const message = readString(payload.message);
  const choices = sanitizeTrustChoices(payload.choices);
  if (!message || choices.length <= 1) return null;
  return { message, choices };
}

export function stripTrustChoicePayload(content: string, payloadMessage: string) {
  const fencePattern = /```(?:json)?\s*[\s\S]*?"choices"[\s\S]*?```/i;
  const withoutFence = content.replace(fencePattern, "").trim();
  if (withoutFence && withoutFence !== content.trim()) return withoutFence;

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const before = content.slice(0, firstBrace).trim();
    const after = content.slice(lastBrace + 1).trim();
    const stripped = [before, after].filter(Boolean).join("\n\n").trim();
    if (stripped) return stripped;
  }

  return payloadMessage;
}

export function buildResearchRunPrompt(topicTitle?: string) {
  const topic = topicTitle?.trim() ? `「${topicTitle.trim()}」` : "当前写作主题";
  return `请为研究主题${topic}继续收集资料：先记录可靠来源，再从原文摘录证据，抽取可验证事实，检查冲突，并生成待审核提案。`;
}

export function buildTrustedDraftPrompt(topicTitle?: string) {
  const topic = topicTitle?.trim() ? `「${topicTitle.trim()}」` : "当前研究主题";
  return `请只使用${topic}中已确认、已采用或有充分证据支持的事实，为我生成一版博客草稿；冲突或证据不足的信息请明确标注为不确定，不要写成确定结论。`;
}

export function buildExplainConflictsPrompt(topicTitle?: string) {
  const topic = topicTitle?.trim() ? `「${topicTitle.trim()}」` : "当前研究主题";
  return `请解释${topic}中存在冲突、过时或证据不足的事实，并告诉我哪些内容不能写成确定结论。`;
}

export function buildOpenResearchChoices(topicTitle?: string): TrustChoicePayload {
  const topic = topicTitle?.trim() ? `「${topicTitle.trim()}」` : "当前主题";
  return {
    message: `${topic}已经进入研究写作上下文。你可以先继续研究，也可以去研究图谱审核事实和冲突。`,
    choices: sanitizeTrustChoices([
      { label: "继续研究", kind: "action", action: "continue_research" },
      { label: "去图谱审核", kind: "action", action: "open_research_graph" },
      { label: "用已确认事实写草稿", kind: "action", action: "write_from_confirmed_facts" },
    ]),
  };
}

export function buildDraftChoices(topicTitle?: string): TrustChoicePayload {
  const topic = topicTitle?.trim() ? `「${topicTitle.trim()}」` : "当前主题";
  return {
    message: `我可以基于${topic}中已确认事实写草稿。建议先确认冲突事实已经处理，再生成正文。`,
    choices: sanitizeTrustChoices([
      { label: "用已确认事实写草稿", kind: "action", action: "write_from_confirmed_facts" },
      { label: "去图谱审核", kind: "action", action: "open_research_graph" },
      { label: "解释冲突", kind: "action", action: "explain_conflicts" },
    ]),
  };
}

export interface TopicSummaryForSelect {
  id: number;
  title: string;
}

export function buildTopicSelectChoices(topics: TopicSummaryForSelect[]): TrustChoicePayload {
  const topicChoices: TrustChoiceOption[] = topics.map((t) => ({
    id: `topic-select-${t.id}`,
    label: t.title,
    kind: "action" as const,
    action: "select_topic" as TrustChoiceAction,
  }));
  topicChoices.push({ id: "topic-create-new", label: "+ 新建主题", kind: "action", action: "create_topic" });
  topicChoices.push({ id: "trust-choice-dismiss", label: "不选择", kind: "action", action: "dismiss" });
  return {
    message: "选择一个研究主题开始写作，或创建新主题：",
    choices: topicChoices,
  };
}
