import { useState } from "react";
import { useAuth } from "../../stores/authStore";
import type { AuthUser } from "../../stores/authStore";

interface LoginFormProps {
  onSuccess?: (user: AuthUser) => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "请求失败");
        return;
      }
      login(data.token, data.user);
      onSuccess?.(data.user);
    } catch {
      setError("网络错误，请检查后端是否运行");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex rounded-lg bg-muted p-1">
        <button
          type="button"
          className={`flex-1 py-2 text-sm rounded-md transition-colors ${
            mode === "login" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
          onClick={() => { setMode("login"); setError(""); }}
        >
          登录
        </button>
        <button
          type="button"
          className={`flex-1 py-2 text-sm rounded-md transition-colors ${
            mode === "register" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
          onClick={() => { setMode("register"); setError(""); }}
        >
          注册
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">用户名</label>
          <input
            type="text"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">密码</label>
          <input
            type="password"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground outline-none focus:ring-2 focus:ring-primary"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
        </button>
      </form>
    </>
  );
}
