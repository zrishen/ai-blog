/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  FileUploadNetworkError,
  getFileProcessingJob,
  listActiveFileProcessingJobs,
  listFileProcessingJobsByRequestId,
  uploadToFileLibrary,
  type FileProcessingJob,
} from "../../api/files";
import { restoreTrashItem, type TrashItem } from "../../api/trash";
import { joinAiKnowledge } from "../../api/workspace";
import { useAuth } from "../../stores/authStore";
import { useChatDispatch } from "../../stores/chatStore";
import { FileProcessingProgress, type FileProcessingProgressValue } from "./FileProcessingProgress";
import { X } from "lucide-react";

const STORAGE_KEY = "file_processing_upload_v1";
const POLL_MS = 1000;

type UploadPhase = "network" | "server";

interface StoredUpload {
  requestId: string;
  fileName: string;
  categoryId: number | null;
  phase: UploadPhase;
  percent: number | null;
  stage: string;
  jobId?: string;
}

export interface UploadTask extends FileProcessingProgressValue {
  requestId: string;
  fileName: string;
  categoryId: number | null;
  phase: UploadPhase;
  status: "active" | "failed";
  error: string | null;
}

interface FileProcessingContextValue {
  uploadTask: UploadTask | null;
  isUploadActive: boolean;
  startUpload: (file: File, categoryId?: number) => Promise<void>;
  restoreJobs: Record<number, FileProcessingJob>;
  restoreFile: (item: TrashItem) => Promise<void>;
  consumeRestoreSuccess: (sourceId: number, jobId: string) => void;
  clearUploadError: () => void;
  // 「加入 AI 知识」索引 job：key = `${target_resource_type}:${target_resource_id}`
  indexJobs: Record<string, FileProcessingJob>;
  joinToAiKnowledge: (resourceType: string, resourceId: number) => Promise<void>;
  consumeIndexSuccess: (key: string, jobId: string) => void;
  // 乐观加入的资源 key（API 返回前先在中栏显示）；真实 RagSource 到达后被 consumeOptimistic 清理
  optimisticKeys: string[];
  consumeOptimistic: (realKeys: Set<string>) => void;
}

const FileProcessingContext = createContext<FileProcessingContextValue | null>(null);

function makeRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function jobStage(job: FileProcessingJob) {
  if (job.status === "failed") return job.error_message || "文件处理失败";
  if (job.status === "succeeded") return "文件处理完成";
  return job.current_stage || (job.status === "queued" ? "等待服务器处理" : "正在处理文件");
}

function mergeJob(previous: FileProcessingJob | null | undefined, next: FileProcessingJob): FileProcessingJob {
  if (!previous) return next;
  return { ...next, progress_percent: Math.max(previous.progress_percent, next.progress_percent) };
}

function saveUpload(task: UploadTask | null) {
  if (!task || task.status === "failed") {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  const stored: StoredUpload = {
    requestId: task.requestId,
    fileName: task.fileName,
    categoryId: task.categoryId,
    phase: task.phase,
    percent: task.percent,
    stage: task.stage,
    jobId: task.job?.id,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function readStoredUpload(): StoredUpload | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUpload;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function newestJob(jobs: FileProcessingJob[]) {
  return [...jobs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

export function FileProcessingProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const dispatch = useChatDispatch();
  const [uploadTask, setUploadTask] = useState<UploadTask | null>(null);
  const [restoreJobs, setRestoreJobs] = useState<Record<number, FileProcessingJob>>({});
  const [indexJobs, setIndexJobs] = useState<Record<string, FileProcessingJob>>({});
  const [optimisticKeys, setOptimisticKeys] = useState<string[]>([]);
  const uploadCancelRef = useRef<(() => void) | null>(null);
  const timersRef = useRef(new Map<string, number>());
  const pollingRef = useRef(new Set<string>());
  const completedRef = useRef(new Set<string>());

  const clearPoll = useCallback((key: string) => {
    const timer = timersRef.current.get(key);
    if (timer != null) window.clearTimeout(timer);
    timersRef.current.delete(key);
    pollingRef.current.delete(key);
  }, []);

  const onSucceeded = useCallback((key: string, kind: "upload" | "restore" | "index") => {
    if (completedRef.current.has(key)) return;
    completedRef.current.add(key);
    if (kind === "restore") dispatch({ type: "INCREMENT_FILE_RESTORE_REVISIONS" });
    else if (kind === "index") dispatch({ type: "INCREMENT_AI_KNOWLEDGE_REVISION" });
    else dispatch({ type: "INCREMENT_FILE_LIBRARY_REVISION" });
  }, [dispatch]);

  const consumeIndexSuccess = useCallback((key: string, jobId: string) => {
    setIndexJobs((current) => {
      if (current[key]?.id !== jobId) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const consumeOptimistic = useCallback((realKeys: Set<string>) => {
    setOptimisticKeys((prev) => {
      const next = prev.filter((k) => !realKeys.has(k));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  const pollJob = useCallback(
    (
      jobId: string,
      kind: "upload" | "restore" | "index",
      sourceId?: number,
      indexKey?: string,
    ) => {
      const key = `${kind}:${jobId}`;
      if (pollingRef.current.has(key)) return;
      pollingRef.current.add(key);

      const tick = async () => {
        try {
          const latest = await getFileProcessingJob(jobId);
          if (kind === "upload") {
            setUploadTask((current) => {
              if (!current || (current.job && current.job.id !== jobId)) return current;
              const job = mergeJob(current.job, latest);
              const next = {
                ...current,
                phase: "server" as const,
                percent: Math.max(current.percent ?? 0, job.progress_percent),
                stage: jobStage(job),
                job,
              };
              saveUpload(next);
              return next;
            });
          } else if (kind === "index" && indexKey) {
            setIndexJobs((current) => ({ ...current, [indexKey]: mergeJob(current[indexKey], latest) }));
          } else if (sourceId != null) {
            setRestoreJobs((current) => ({ ...current, [sourceId]: mergeJob(current[sourceId], latest) }));
          }

          if (latest.status === "succeeded") {
            clearPoll(key);
            onSucceeded(key, kind);
            if (kind === "upload") {
              sessionStorage.removeItem(STORAGE_KEY);
              setUploadTask(null);
            } else if (kind === "index" && indexKey) {
              consumeIndexSuccess(indexKey, jobId);
            }
            return;
          }
          if (latest.status === "failed") {
            clearPoll(key);
            if (kind === "upload") {
              sessionStorage.removeItem(STORAGE_KEY);
              setUploadTask((current) => current ? { ...current, status: "failed", error: latest.error_message || "文件处理失败" } : current);
            } else if (kind === "index" && indexKey) {
              consumeIndexSuccess(indexKey, jobId);
              dispatch({ type: "INCREMENT_AI_KNOWLEDGE_REVISION" });
            } else if (kind === "restore") {
              // 还原 job 失败：触发刷新让回收站视图回滚乐观移除
              dispatch({ type: "INCREMENT_FILE_RESTORE_REVISIONS" });
            }
            return;
          }
          timersRef.current.set(key, window.setTimeout(tick, POLL_MS));
        } catch {
          timersRef.current.set(key, window.setTimeout(tick, POLL_MS));
        }
      };

      void tick();
    },
    [clearPoll, consumeIndexSuccess, dispatch, onSucceeded],
  );

  const attachUploadJob = useCallback((job: FileProcessingJob, stored?: StoredUpload | null) => {
    const task: UploadTask = {
      requestId: job.client_request_id || stored?.requestId || "",
      fileName: stored?.fileName || job.original_name,
      categoryId: stored?.categoryId ?? job.category_id,
      phase: "server",
      percent: Math.max(stored?.percent ?? 0, job.progress_percent),
      stage: jobStage(job),
      job,
      status: job.status === "failed" ? "failed" : "active",
      error: job.status === "failed" ? job.error_message || "文件处理失败" : null,
    };
    setUploadTask(task);
    saveUpload(task);
    if (job.status === "succeeded") {
      onSucceeded(`upload:${job.id}`, "upload");
      setUploadTask(null);
      sessionStorage.removeItem(STORAGE_KEY);
    } else if (job.status !== "failed") {
      pollJob(job.id, "upload");
    }
  }, [onSucceeded, pollJob]);

  const reconnectRequest = useCallback(async (stored: StoredUpload, interruptedNetwork: boolean) => {
    let jobs = await listFileProcessingJobsByRequestId(stored.requestId);
    if (jobs.length === 0) {
      const active = await listActiveFileProcessingJobs();
      jobs = active.filter((job) => job.client_request_id === stored.requestId);
    }
    const job = newestJob(jobs);
    if (!job) {
      sessionStorage.removeItem(STORAGE_KEY);
      setUploadTask({
        requestId: stored.requestId,
        fileName: stored.fileName,
        categoryId: stored.categoryId,
        phase: stored.phase,
        percent: stored.percent,
        stage: interruptedNetwork ? "上传已中断" : stored.stage,
        job: null,
        status: "failed",
        error: "上传已中断，请重新选择文件",
      });
      return;
    }
    attachUploadJob(job, stored);
  }, [attachUploadJob]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const bootstrap = async () => {
      const stored = readStoredUpload();
      try {
        const active = await listActiveFileProcessingJobs();
        if (cancelled) return;

        for (const job of active) {
          if (job.job_type === "restore" && job.source_document_id != null) {
            const sourceId = job.source_document_id;
            setRestoreJobs((current) => ({ ...current, [sourceId]: mergeJob(current[sourceId], job) }));
            pollJob(job.id, "restore", sourceId);
          } else if (
            job.job_type === "index" &&
            job.target_resource_type &&
            job.target_resource_id != null
          ) {
            const idxKey = `${job.target_resource_type}:${job.target_resource_id}`;
            setIndexJobs((current) => ({ ...current, [idxKey]: mergeJob(current[idxKey], job) }));
            pollJob(job.id, "index", undefined, idxKey);
          }
        }

        const activeUploads = active.filter((job) => job.job_type === "upload");
        const matchingUpload = stored
          ? newestJob(activeUploads.filter((job) => job.client_request_id === stored.requestId))
          : undefined;
        const activeUpload = matchingUpload || newestJob(activeUploads);
        if (activeUpload) {
          attachUploadJob(activeUpload, matchingUpload ? stored : null);
        } else if (stored) {
          await reconnectRequest(stored, stored.phase === "network");
        }
      } catch {
        if (!cancelled && stored) {
          await reconnectRequest(stored, stored.phase === "network").catch(() => undefined);
        }
      }
    };

    void bootstrap();
    return () => { cancelled = true; };
  }, [attachUploadJob, isAuthenticated, pollJob, reconnectRequest]);

  useEffect(() => {
    if (isAuthenticated) return;
    uploadCancelRef.current?.();
    uploadCancelRef.current = null;
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
    pollingRef.current.clear();
    completedRef.current.clear();
    // 登出时同步清理当前用户的本地任务状态
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUploadTask(null);
    setRestoreJobs({});
    setIndexJobs({});
    setOptimisticKeys([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }, [isAuthenticated]);

  useEffect(() => () => {
    uploadCancelRef.current?.();
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
    pollingRef.current.clear();
  }, []);

  const startUpload = useCallback(async (file: File, categoryId?: number) => {
    if (uploadTask?.status === "active") return;
    const requestId = makeRequestId();
    const initial: UploadTask = {
      requestId,
      fileName: file.name,
      categoryId: categoryId ?? null,
      phase: "network",
      percent: 0,
      stage: "准备上传文件",
      job: null,
      status: "active",
      error: null,
    };
    setUploadTask(initial);
    saveUpload(initial);
    const request = uploadToFileLibrary(file, categoryId, requestId, (progress) => {
      setUploadTask((current) => {
        if (!current || current.requestId !== requestId) return current;
        const percent = progress.percent == null ? current.percent : Math.max(current.percent ?? 0, progress.percent);
        const next = { ...current, percent, stage: progress.stage };
        saveUpload(next);
        return next;
      });
    });
    uploadCancelRef.current = request.cancel;

    try {
      const job = await request.promise;
      uploadCancelRef.current = null;
      attachUploadJob(job, readStoredUpload());
    } catch (error) {
      uploadCancelRef.current = null;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof FileUploadNetworkError) {
        const latest = readStoredUpload();
        const stored: StoredUpload = latest?.requestId === requestId ? latest : {
          requestId,
          fileName: file.name,
          categoryId: categoryId ?? null,
          phase: "network",
          percent: 0,
          stage: "上传连接中断",
        };
        await reconnectRequest(stored, true).catch(() => {
          sessionStorage.removeItem(STORAGE_KEY);
          setUploadTask((current) => current?.requestId === requestId
            ? { ...current, status: "failed", error: "上传已中断，请重新选择文件" }
            : current);
        });
        return;
      }
      sessionStorage.removeItem(STORAGE_KEY);
      const message = error instanceof Error ? error.message : "文件库上传失败";
      setUploadTask((current) => current?.requestId === requestId
        ? { ...current, status: "failed", stage: "上传失败", error: message }
        : current);
    }
  }, [attachUploadJob, reconnectRequest, uploadTask]);

  const restoreFile = useCallback(async (item: TrashItem) => {
    const result = await restoreTrashItem("file_document", item.id);
    if (!result) throw new Error("恢复任务响应为空");
    setRestoreJobs((current) => ({ ...current, [item.id]: result }));
    if (result.status === "succeeded") {
      onSucceeded(`restore:${result.id}`, "restore");
    } else if (result.status !== "failed") {
      pollJob(result.id, "restore", item.id);
    }
  }, [onSucceeded, pollJob]);

  const consumeRestoreSuccess = useCallback((sourceId: number, jobId: string) => {
    setRestoreJobs((current) => {
      if (current[sourceId]?.id !== jobId || current[sourceId]?.status !== "succeeded") return current;
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }, []);

  const joinToAiKnowledge = useCallback(async (resourceType: string, resourceId: number) => {
    const optimisticKey = `${resourceType}:${resourceId}`;
    setOptimisticKeys((prev) => (prev.includes(optimisticKey) ? prev : [...prev, optimisticKey]));
    try {
      const result = await joinAiKnowledge(resourceType, resourceId);
      const job = result.job;
      if (job) {
        const key =
          job.target_resource_type && job.target_resource_id != null
            ? `${job.target_resource_type}:${job.target_resource_id}`
            : optimisticKey;
        setIndexJobs((current) => ({ ...current, [key]: mergeJob(current[key], job) }));
        if (job.status !== "succeeded" && job.status !== "failed") {
          pollJob(job.id, "index", undefined, key);
        }
      }
      dispatch({ type: "INCREMENT_AI_KNOWLEDGE_REVISION" });
    } catch (e) {
      setOptimisticKeys((prev) => prev.filter((k) => k !== optimisticKey));
      throw e;
    }
  }, [dispatch, pollJob]);

  const clearUploadError = useCallback(() => {
    setUploadTask((current) => current?.status === "failed" ? null : current);
  }, []);

  return (
    <FileProcessingContext.Provider value={{
      uploadTask,
      isUploadActive: uploadTask?.status === "active",
      startUpload,
      restoreJobs,
      restoreFile,
      consumeRestoreSuccess,
      clearUploadError,
      indexJobs,
      joinToAiKnowledge,
      consumeIndexSuccess,
      optimisticKeys,
      consumeOptimistic,
    }}>
      {children}
      {uploadTask && (
        <div
          role="status"
          aria-live="polite"
          data-testid="file-processing-upload-overlay"
          className="fixed top-20 left-1/2 z-50 w-[380px] max-w-[90vw] -translate-x-1/2 rounded-panel border border-border/70 bg-card/95 px-4 py-3 shadow-2xl shadow-foreground/10 backdrop-blur-xl"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-meta font-medium">{uploadTask.fileName}</div>
            {uploadTask.status === "failed" && (
              <button
                type="button"
                onClick={clearUploadError}
                aria-label="关闭上传提示"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {uploadTask.status === "failed" ? (
            <div className="text-fine leading-relaxed text-destructive">{uploadTask.error}</div>
          ) : (
            <FileProcessingProgress value={uploadTask} />
          )}
        </div>
      )}
    </FileProcessingContext.Provider>
  );
}

export function useFileProcessing() {
  const context = useContext(FileProcessingContext);
  if (!context) throw new Error("useFileProcessing must be used within FileProcessingProvider");
  return context;
}
