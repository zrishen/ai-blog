import { API_BASE, apiFetch, assertOk, parseJson } from "./client";

export interface BlogPostData {
  id: number;
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  cover_image?: string;
  status: string;
  tags?: string;
  author?: string;
  view_count: number;
  created_at: string;
  updated_at?: string;
  published_at?: string;
}

export interface BlogListResponse {
  posts: BlogPostData[];
  total: number;
  page: number;
  per_page: number;
}

export interface BlogRevisionSummary {
  id: number;
  revision_number: number;
  kind: "commit" | "publish" | "pre_restore";
  title: string;
  created_at: string;
  is_published: boolean;
}

export interface BlogRevision extends BlogRevisionSummary {
  slug: string;
  content: string;
  excerpt?: string | null;
  cover_image?: string | null;
  category_id?: number | null;
  tags?: string | null;
  author?: string | null;
}

export interface SiteUserData {
  id: number;
  username: string;
  created_at: string;
  is_owner: boolean;
  sidebar_html?: string | null;
  show_tags?: boolean;
}

export async function getSiteUser(username: string): Promise<SiteUserData> {
  const res = await apiFetch(`${API_BASE}/public/users/${encodeURIComponent(username)}`);
  await assertOk(res, "Failed to fetch site user");
  return parseJson<SiteUserData>(res);
}

export async function listSitePosts(username: string, params?: {
  include_drafts?: boolean;
  status?: string;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<BlogListResponse> {
  const q = new URLSearchParams();
  if (params?.include_drafts) q.set("include_drafts", "true");
  if (params?.status) q.set("status", params.status);
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.per_page) q.set("per_page", String(params.per_page));
  const query = q.toString();
  const res = await apiFetch(`${API_BASE}/public/users/${encodeURIComponent(username)}/posts${query ? "?" + query : ""}`);
  await assertOk(res, "Failed to fetch site posts");
  return parseJson<BlogListResponse>(res);
}

export async function getSitePost(username: string, slug: string): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/public/users/${encodeURIComponent(username)}/posts/${encodeURIComponent(slug)}`);
  await assertOk(res, "Failed to fetch site post");
  return parseJson<BlogPostData>(res);
}

export async function listBlogPosts(params?: {
  status?: string;
  search?: string;
  page?: number;
  per_page?: number;
}): Promise<BlogListResponse> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.per_page) q.set("per_page", String(params.per_page));
  const query = q.toString();
  const res = await apiFetch(`${API_BASE}/blog/posts${query ? "?" + query : ""}`);
  await assertOk(res, "Failed to fetch blog posts");
  return parseJson<BlogListResponse>(res);
}

export async function getBlogPost(id: number): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}`);
  await assertOk(res, "Failed to fetch blog post");
  return parseJson<BlogPostData>(res);
}

export async function createBlogPost(data: {
  title: string;
  content: string;
  excerpt?: string;
  cover_image?: string | null;
  status?: string;
  tags?: string;
  author?: string;
}): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to create blog post");
  return parseJson<BlogPostData>(res);
}

export async function updateBlogPost(id: number, data: {
  title?: string;
  content?: string;
  excerpt?: string;
  cover_image?: string | null;
  status?: string;
  tags?: string;
}): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to update blog post");
  return parseJson<BlogPostData>(res);
}

export async function deleteBlogPost(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}`, { method: "DELETE" });
  await assertOk(res, "Failed to delete blog post");
}

export async function publishBlogPost(id: number, publish: boolean): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}/publish`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish }),
  });
  await assertOk(res, "Failed to publish/unpublish blog post");
  return parseJson<BlogPostData>(res);
}

export async function listBlogRevisions(id: number): Promise<BlogRevisionSummary[]> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}/revisions`);
  await assertOk(res, "Failed to fetch blog revisions");
  const data = await parseJson<{ revisions: BlogRevisionSummary[] }>(res);
  return data.revisions;
}

export async function getBlogRevision(postId: number, revisionId: number): Promise<BlogRevision> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/revisions/${revisionId}`);
  await assertOk(res, "Failed to fetch blog revision");
  return parseJson<BlogRevision>(res);
}

export async function commitBlogRevision(postId: number): Promise<BlogRevision> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/revisions`, { method: "POST" });
  await assertOk(res, "Failed to create blog revision");
  return parseJson<BlogRevision>(res);
}

export async function restoreBlogRevision(postId: number, revisionId: number): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/revisions/${revisionId}/restore`, {
    method: "POST",
  });
  await assertOk(res, "Failed to restore blog revision");
  return parseJson<BlogPostData>(res);
}

export async function deleteBlogRevision(postId: number, revisionId: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${postId}/revisions/${revisionId}`, {
    method: "DELETE",
  });
  await assertOk(res, "Failed to delete blog revision");
}

export async function updateSidebarSettings(showTags: boolean): Promise<void> {
  const res = await apiFetch(`${API_BASE}/settings/sidebar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show_tags: showTags }),
  });
  await assertOk(res, "Failed to update sidebar settings");
}

export async function generateBlogCover(id: number): Promise<BlogPostData> {
  const res = await apiFetch(`${API_BASE}/blog/posts/${id}/generate-cover`, {
    method: "POST",
  });
  await assertOk(res, `Failed to generate blog cover`);
  return parseJson<BlogPostData>(res);
}

export async function suggestBlogTags(id: number): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await apiFetch(`${API_BASE}/blog/posts/${id}/suggest-tags`, {
      method: "POST",
      signal: controller.signal,
    });
    await assertOk(res, "标签生成失败");
    const data = await parseJson<{ tags: string[] }>(res);
    return data.tags;
  } finally {
    clearTimeout(timeout);
  }
}
