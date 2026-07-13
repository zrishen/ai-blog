const API_BASE = "/api";

// ---- Auth-aware fetch wrapper ----

async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = localStorage.getItem("auth_token");
  const headers = new Headers(options?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.dispatchEvent(new Event("auth:logout"));
  }
  return res;
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    return typeof data.detail === "string" ? data.detail : fallback;
  } catch {
    return text;
  }
}

export { API_BASE, apiFetch, readErrorDetail };

// Re-export domain modules for backward compatibility.
export * from "./auth";
export * from "./conversations";
export * from "./chat";
export * from "./mcp";
export * from "./research";
export * from "./blog";
export * from "./files";
export * from "./trash";
