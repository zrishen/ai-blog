import { useState } from "react";

import { useAuth } from "@/stores/authStore";

import type { AuthUser } from "@/stores/authStore";

import { parseJson } from "@/api/client";
import { isAuthUser } from "@/lib/isAuthUser";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface LoginFormProps {
  onSuccess?: (user: AuthUser) => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const endpoint = mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register" ? { username, password, invite_code: inviteCode } : { username, password },
        ),
        credentials: "include",
      });
      const data = await parseJson<{
        access_token?: string;
        user?: AuthUser;
        detail?: unknown;
      }>(res);
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "请求失败");
        return;
      }
      if (typeof data.access_token !== "string" || !isAuthUser(data.user)) {
        setError("登录响应格式异常");
        return;
      }
      login(data.access_token, data.user);
      onSuccess?.(data.user);
    } catch {
      setError("网络错误，请检查后端是否运行");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Tabs
        variant="underline"
        value={mode}
        onValueChange={(value) => {
          if (value === "login" || value === "register") {
            setMode(value);
            setError("");
          }
        }}
      >
        <TabsList className="grid w-full grid-cols-2" aria-label="登录方式">
          <TabsTrigger value="login">登录</TabsTrigger>
          <TabsTrigger value="register">注册</TabsTrigger>
        </TabsList>
        <TabsContent value={mode} className="mt-5">
          <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="auth-username" className="block mb-1">用户名</Label>
          <Input
            id="auth-username"
            name="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="auth-password" className="block mb-1">密码</Label>
          <Input
            id="auth-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
          />
        </div>

        {mode === "register" && (
          <div>
            <Label htmlFor="auth-invite-code" className="block mb-1">邀请码</Label>
            <Input
              id="auth-invite-code"
              name="invite_code"
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
        )}

        {error && <Alert variant="destructive">{error}</Alert>}

        <Button
          type="submit"
          disabled={loading}
          className="w-full"
        >
          {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
        </Button>
          </form>
        </TabsContent>
      </Tabs>
    </>
  );
}
