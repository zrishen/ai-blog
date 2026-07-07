import { API_BASE } from "./client";

export function getPreviewUrl(filename: string): string {
  const token = localStorage.getItem("auth_token");
  const base = `${API_BASE}/preview/${encodeURIComponent(filename)}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
