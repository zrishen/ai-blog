import type { Message } from "@/types/chat";

export function formatThinkingDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 1) return "< 1 秒";
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

export type ToolPair = {
  start?: NonNullable<Message["toolEvents"]>[number];
  end?: NonNullable<Message["toolEvents"]>[number];
};

export type ThinkingEntry =
  | { type: "reasoning"; key: string; content: string }
  | { type: "process"; key: string; content: string }
  | { type: "action"; key: string; tools: ToolPair[] };

function normalizeThinkingText(text?: string) {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

export function buildThinkingEntries({
  reasoningContent,
  loopSteps,
  toolEvents,
  fallbackProcessContent,
  streamingRound,
}: {
  reasoningContent?: string;
  loopSteps?: string[];
  toolEvents?: Message["toolEvents"];
  fallbackProcessContent?: string;
  streamingRound?: string;
}): ThinkingEntry[] {
  const entries: ThinkingEntry[] = [];
  const reasoning = normalizeThinkingText(reasoningContent);
  if (reasoning && reasoning.length > 3) entries.push({ type: "reasoning", key: "reasoning", content: reasoning });

  const processes = (loopSteps && loopSteps.length > 0 ? loopSteps : fallbackProcessContent ? [fallbackProcessContent] : [])
    .map(normalizeThinkingText)
    .filter((step) => step.length > 3);
  const toolPairs = buildToolPairs(toolEvents);
  const toolGroups = groupToolPairsForProcesses(toolPairs, processes.length);
  const maxLen = Math.max(processes.length, toolGroups.length);

  const temporaryRound = normalizeThinkingText(streamingRound);
  let streamingRoundPlaced = false;
  for (let i = 0; i < maxLen; i += 1) {
    if (processes[i]) {
      entries.push({ type: "process", key: `round-${i}`, content: processes[i] });
    } else if (temporaryRound && i === processes.length && !streamingRoundPlaced) {
      entries.push({ type: "process", key: "streaming-round-live", content: temporaryRound });
      streamingRoundPlaced = true;
    }
    if (toolGroups[i]?.length) entries.push({ type: "action", key: `tools-${i}`, tools: toolGroups[i] });
  }

  if (temporaryRound && !streamingRoundPlaced && !processes.includes(temporaryRound)) {
    entries.push({ type: "process", key: "streaming-round-live", content: temporaryRound });
  }
  return entries;
}

function buildToolPairs(toolEvents?: Message["toolEvents"]): ToolPair[] {
  const toolPairs: ToolPair[] = [];
  if (!toolEvents) return toolPairs;

  const pairByCallId = new Map<string, ToolPair>();
  for (const evt of toolEvents) {
    if (evt.callId) {
      let pair = pairByCallId.get(evt.callId);
      if (!pair) {
        pair = {};
        pairByCallId.set(evt.callId, pair);
        toolPairs.push(pair);
      }
      if (evt.type === "start") pair.start = evt;
      else pair.end = evt;
    } else if (evt.type === "start") {
      toolPairs.push({ start: evt });
    } else {
      const last = toolPairs[toolPairs.length - 1];
      if (last && !last.end && (!last.start || !last.start.callId)) {
        last.end = evt;
      } else {
        toolPairs.push({ end: evt });
      }
    }
  }
  return toolPairs;
}

function groupToolPairsForProcesses(toolPairs: ToolPair[], processCount: number): ToolPair[][] {
  if (toolPairs.length === 0) return [];

  const pairRoundId = (pair: ToolPair) => pair.start?.roundId ?? pair.end?.roundId;
  if (toolPairs.some((pair) => pairRoundId(pair) !== undefined)) {
    const groupMap = new Map<number, ToolPair[]>();
    for (const pair of toolPairs) {
      const idx = pairRoundId(pair) ?? 0;
      if (!groupMap.has(idx)) groupMap.set(idx, []);
      groupMap.get(idx).push(pair);
    }
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, group]) => group);
  }

  const hasLoopStepIndex = toolPairs.some((pair) =>
    pair.start?.loopStepIndex !== undefined || pair.end?.loopStepIndex !== undefined);

  if (hasLoopStepIndex) {
    const groupMap = new Map<number, ToolPair[]>();
    for (const pair of toolPairs) {
      const idx = pair.start?.loopStepIndex ?? pair.end?.loopStepIndex ?? 0;
      if (!groupMap.has(idx)) groupMap.set(idx, []);
      groupMap.get(idx).push(pair);
    }
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, group]) => group);
  }

  if (processCount <= 1) return [toolPairs];
  const groups: ToolPair[][] = Array.from({ length: processCount }, () => []);
  toolPairs.forEach((pair, index) => {
    groups[Math.min(index, processCount - 1)].push(pair);
  });
  return groups.filter((group) => group.length > 0);
}

export function countThinkingSteps(entries: ThinkingEntry[]) {
  const actionCount = entries.filter((entry) => entry.type === "action").length;
  const processCount = entries.filter((entry) => entry.type === "process").length;
  return Math.max(actionCount, processCount);
}
