import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  listTrash,
  restoreTrashItem,
  purgeTrashItem,
  emptyTrash,
} from "../../src/api/trash";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("trash API", () => {
  it("listTrash 发 GET /api/trash 并返回 items/total", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { type: "conversation", id: 1, name: "对话 A", deleted_at: "2026-07-13T00:00:00Z" },
        ],
        total: 1,
      }),
    );
    const result = await listTrash();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/trash", expect.objectContaining({}));
    expect(result.total).toBe(1);
    expect(result.items[0].type).toBe("conversation");
  });

  it("restoreTrashItem 发 POST /api/trash/{type}/{id}/restore", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await restoreTrashItem("blog_post", 42);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/trash/blog_post/42/restore",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("purgeTrashItem 发 DELETE /api/trash/{type}/{id}", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await purgeTrashItem("file_document", 7);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/trash/file_document/7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("emptyTrash 发 DELETE /api/trash 并透传 partial 状态", async () => {
    const partial = {
      status: "partial",
      deleted: [{ type: "conversation", id: 1 }],
      failed: [
        {
          item: { type: "blog_post", id: 9 },
          code: "in_use",
          message: "文章正在被使用",
        },
      ],
      remaining: 1,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(partial));
    const result = await emptyTrash();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/trash",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result.status).toBe("partial");
    expect(result.failed[0].item.id).toBe(9);
    expect(result.remaining).toBe(1);
  });

  it("listTrash 非 2xx 抛错", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(listTrash()).rejects.toThrow("Failed to fetch trash items");
  });
});
