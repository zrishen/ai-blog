import { LoginForm } from "./LoginForm";

export function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-sm p-8 space-y-6 rounded-2xl shadow-lg border border-border bg-card">
        <h1 className="text-2xl font-bold text-center text-foreground">ai-blog</h1>
        <LoginForm />
      </div>
    </div>
  );
}
