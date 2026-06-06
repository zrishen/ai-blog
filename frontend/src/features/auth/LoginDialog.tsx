import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LoginForm } from "./LoginForm";
import type { AuthUser } from "../../stores/authStore";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (user: AuthUser) => void;
}

export function LoginDialog({ open, onOpenChange, onSuccess }: LoginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>登录到 AI Blog</DialogTitle>
          <DialogDescription>输入你的用户名和密码以继续。</DialogDescription>
        </DialogHeader>
        <LoginForm onSuccess={(user) => { onOpenChange(false); onSuccess?.(user); }} />
      </DialogContent>
    </Dialog>
  );
}
