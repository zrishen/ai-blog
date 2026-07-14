import type { FileProcessingJob, FileProcessingStage } from "../../api/files";

export interface FileProcessingProgressValue {
  percent: number | null;
  stage: string;
  job?: FileProcessingJob | null;
}

const STAGE_LABELS: Record<string, string> = {
  browser_upload: "正在上传",
  persist_file: "服务器保存",
  cleanup_index: "清理旧索引",
  parse: "解析文件",
  chunk: "切分文本",
  embedding: "生成向量",
  metadata: "整理元数据",
  vector_store: "写入向量库",
  finalize: "完成文件记录",
  queued: "等待处理",
};

const UNIT_LABELS: Record<string, string> = {
  file: "文件",
  operation: "操作",
  block: "文本块",
  sheet: "工作表",
  page: "页",
  chunk: "片段",
  transaction: "事务",
};

const CHUNK_PIPELINE_STAGES = ["embedding", "metadata", "vector_store"] as const;

export function getFileProcessingStageLabel(stage: string) {
  return STAGE_LABELS[stage] ?? stage;
}

function getCurrentStage(job?: FileProcessingJob | null): FileProcessingStage | null {
  if (!job?.progress_json?.stages) return null;
  const stageKey = job.progress_json.current_stage || job.current_stage;
  return job.progress_json.stages[stageKey] ?? null;
}

function getDisplayStage(job?: FileProcessingJob | null): FileProcessingStage | null {
  const stage = getCurrentStage(job);
  if (!stage || !job?.progress_json?.stages) return stage;
  const stageKey = job.progress_json.current_stage || job.current_stage || "";
  if (!stageKey || !(CHUNK_PIPELINE_STAGES as readonly string[]).includes(stageKey)) {
    return stage;
  }
  const stages = job.progress_json.stages;
  const perStageTotal =
    stages.embedding?.total || stages.metadata?.total || stages.vector_store?.total || stage.total;
  if (!perStageTotal || perStageTotal <= 0) return stage;
  const stageIndex = CHUNK_PIPELINE_STAGES.indexOf(stageKey as (typeof CHUNK_PIPELINE_STAGES)[number]);
  const previousCompleted = stageIndex * perStageTotal;
  return {
    completed: previousCompleted + Math.max(0, stage.completed),
    total: perStageTotal * CHUNK_PIPELINE_STAGES.length,
    unit: "chunk",
  };
}

export function FileProcessingProgress({ value }: { value: FileProcessingProgressValue }) {
  const stage = getDisplayStage(value.job);
  const stageKey = value.job?.progress_json?.current_stage || value.job?.current_stage;
  const stageLabel = stageKey ? getFileProcessingStageLabel(stageKey) : value.stage;
  const percent = value.percent == null ? undefined : Math.max(0, Math.min(100, value.percent));
  const unitText = stage && stage.total > 0
    ? `${stage.completed}/${stage.total} ${UNIT_LABELS[stage.unit] ?? stage.unit}`
    : null;
  const detailText = [unitText, percent === undefined ? null : `${percent}%`].filter(Boolean).join(" · ");

  return (
    <div className="min-w-0 space-y-1.5" data-testid="file-processing-progress">
      <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
        <span className="truncate">{stageLabel}</span>
        {detailText && <span className="shrink-0 tabular-nums">{detailText}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={stageLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={detailText || stageLabel}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={`h-full rounded-full bg-primary transition-[width] duration-300 ${percent === undefined ? "w-1/3 animate-pulse" : ""}`}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
