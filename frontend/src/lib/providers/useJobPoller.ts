import { useCallback, useRef } from "react";

import { getFileProcessingJob, type FileProcessingJob } from "../../api/files";

const POLL_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_POLL_ATTEMPTS = 30;

export type JobKind = "upload" | "restore" | "index";

export interface JobPollHandlers {
  onUpdate?: (job: FileProcessingJob) => void;
  onSucceeded?: (job: FileProcessingJob) => void;
  onFailed?: (job: FileProcessingJob) => void;
  onCancelled?: (job: FileProcessingJob) => void;
}

// 轮询基座：setTimeout 循环 + 终态分发，upload/restore/index 三类 job 复用。
export function useJobPoller() {
  const timersRef = useRef(new Map<string, number>());
  const pollingRef = useRef(new Set<string>());
  const completedRef = useRef(new Set<string>());
  const attemptsRef = useRef(new Map<string, number>());

  const clearPoll = useCallback((key: string) => {
    const timer = timersRef.current.get(key);
    if (timer != null) window.clearTimeout(timer);
    timersRef.current.delete(key);
    pollingRef.current.delete(key);
  }, []);

  const poll = useCallback((jobId: string, kind: JobKind, handlers: JobPollHandlers = {}) => {
    const key = `${kind}:${jobId}`;
    if (pollingRef.current.has(key)) return;
    pollingRef.current.add(key);

    const tick = async () => {
      try {
        const latest = await getFileProcessingJob(jobId);
        attemptsRef.current.delete(key);
        handlers.onUpdate?.(latest);
        if (latest.status === "succeeded") {
          clearPoll(key);
          handlers.onSucceeded?.(latest);
          return;
        }
        if (latest.status === "failed") {
          clearPoll(key);
          handlers.onFailed?.(latest);
          return;
        }
        if (latest.status === "cancelled") {
          clearPoll(key);
          handlers.onCancelled?.(latest);
          return;
        }
        timersRef.current.set(key, window.setTimeout(tick, POLL_MS));
      } catch {
        const attempts = (attemptsRef.current.get(key) ?? 0) + 1;
        if (attempts > MAX_POLL_ATTEMPTS) {
          attemptsRef.current.delete(key);
          clearPoll(key);
          return;
        }
        attemptsRef.current.set(key, attempts);
        const backoff = Math.min(POLL_MS * 2 ** Math.min(attempts, 5), MAX_BACKOFF_MS);
        timersRef.current.set(key, window.setTimeout(tick, backoff));
      }
    };

    void tick();
  }, [clearPoll]);

  // 成功标记：同一 job 只计一次成功通知（revision 幂等）。
  const markSucceeded = useCallback((key: string) => {
    if (completedRef.current.has(key)) return false;
    completedRef.current.add(key);
    return true;
  }, []);

  const clearAll = useCallback(() => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
    pollingRef.current.clear();
    completedRef.current.clear();
    attemptsRef.current.clear();
  }, []);

  return { poll, markSucceeded, clearAll };
}
