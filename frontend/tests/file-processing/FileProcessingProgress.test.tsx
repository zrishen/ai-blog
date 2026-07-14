import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileProcessingProgress } from "../../src/features/file-processing/FileProcessingProgress";
import type { FileProcessingJob } from "../../src/api/files";

function makeJob(overrides: Partial<FileProcessingJob> = {}): FileProcessingJob {
  return {
    id: "5ce58d72-8b04-44ce-a47c-57369d243a42",
    job_type: "upload",
    status: "running",
    current_stage: "embedding",
    progress_model_version: "upload_v1",
    progress_percent: 62,
    progress_json: {
      model_version: "upload_v1",
      current_stage: "embedding",
      stages: { embedding: { completed: 64, total: 128, unit: "chunk" } },
    },
    client_request_id: "729912b7-8b10-4055-b483-4e28a9aa7f68",
    source_document_id: null,
    result_document_id: null,
    original_name: "a.pdf",
    category_id: null,
    error_code: null,
    error_message: null,
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:01Z",
    finished_at: null,
    ...overrides,
  };
}

describe("FileProcessingProgress", () => {
  it("embedding 阶段聚合显示 chunk 计数", () => {
    const job = makeJob({
      progress_percent: 30,
      progress_json: {
        model_version: "upload_v1",
        current_stage: "embedding",
        stages: {
          embedding: { completed: 200, total: 256, unit: "chunk" },
          metadata: { completed: 0, total: 256, unit: "chunk" },
          vector_store: { completed: 0, total: 256, unit: "chunk" },
        },
      },
    });
    render(<FileProcessingProgress value={{ percent: 30, stage: "fallback", job }} />);
    expect(screen.getByText("生成向量")).toBeInTheDocument();
    expect(screen.getByText("200/768 片段 · 30%")).toBeInTheDocument();
  });

  it("vector_store 阶段聚合后 chunk 计数不回退", () => {
    const job = makeJob({
      current_stage: "vector_store",
      progress_percent: 70,
      progress_json: {
        model_version: "upload_v1",
        current_stage: "vector_store",
        stages: {
          embedding: { completed: 256, total: 256, unit: "chunk" },
          metadata: { completed: 256, total: 256, unit: "chunk" },
          vector_store: { completed: 64, total: 256, unit: "chunk" },
        },
      },
    });
    render(<FileProcessingProgress value={{ percent: 70, stage: "fallback", job }} />);
    expect(screen.getByText("写入向量库")).toBeInTheDocument();
    expect(screen.getByText("576/768 片段 · 70%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "576/768 片段 · 70%");
  });

  it("metadata 阶段聚合后包含前序 embedding 的进度", () => {
    const job = makeJob({
      current_stage: "metadata",
      progress_percent: 60,
      progress_json: {
        model_version: "upload_v1",
        current_stage: "metadata",
        stages: {
          embedding: { completed: 256, total: 256, unit: "chunk" },
          metadata: { completed: 100, total: 256, unit: "chunk" },
          vector_store: { completed: 0, total: 256, unit: "chunk" },
        },
      },
    });
    render(<FileProcessingProgress value={{ percent: 60, stage: "fallback", job }} />);
    expect(screen.getByText("整理元数据")).toBeInTheDocument();
    expect(screen.getByText("356/768 片段 · 60%")).toBeInTheDocument();
  });

  it("非 chunk 流水线阶段保持原有计数显示", () => {
    const job = makeJob({
      current_stage: "parse",
      progress_percent: 40,
      progress_json: {
        model_version: "upload_v1",
        current_stage: "parse",
        stages: {
          parse: { completed: 3, total: 10, unit: "page" },
        },
      },
    });
    render(<FileProcessingProgress value={{ percent: 40, stage: "fallback", job }} />);
    expect(screen.getByText("解析文件")).toBeInTheDocument();
    expect(screen.getByText("3/10 页 · 40%")).toBeInTheDocument();
  });

  it("缺少 job 时回退到 stage 文案且不渲染单位", () => {
    render(<FileProcessingProgress value={{ percent: 12, stage: "正在上传文件" }} />);
    expect(screen.getByText("正在上传文件")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
  });
});
